#!/usr/bin/env node
// MCP server: the "execution surface" that lets an AI agent drive the registry's browsers.
//
// The agent (e.g. Claude Code) starts this file as a child process and talks to it over
// stdin/stdout using the Model Context Protocol. Each tool call names an `actor`
// ("admin", "user", ...), which the registry turns into that actor's own browser context.
//
// The loop the agent follows:
//   browser_open      -> returns a snapshot of the page, with element refs like [ref=e5]
//   browser_click/fill on a ref -> returns the new snapshot
//   ...repeat, reading each snapshot to decide the next step.
//
// IMPORTANT: stdout is the protocol channel. Never console.log() here; it would corrupt
// the messages. Use console.error() for debug output; it goes to stderr instead.
//
// Settings come from environment variables: BASE_URL (default http://localhost:3000),
// HEADLESS=1 to hide the windows.

import fs from 'node:fs';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import type { Page } from 'playwright';
import * as registry from '../browser/registry.ts';

registry.configure({
  baseURL: process.env.BASE_URL ?? 'http://localhost:3000',
  headless: Boolean(process.env.HEADLESS),
});

// The version comes from package.json, so a release only bumps it in one place. package.json is two
// folders up from both src/mcp/server.ts (development) and dist/mcp/server.js (published package).
const { version } = JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string };

const server = new McpServer({ name: 'multi-role-browser', version });

// ---------------------------------------------------------------- helpers

// Shared parameter: which actor performs the action.
const actor = z.string().describe(
  'Who performs the action, e.g. "admin" or "user". Each name is a separate browser identity ' +
  'with its own cookies and login. A new name starts logged out.',
);

/** The actor's current tab: the most recently opened one (so popups win). Opens one if needed. */
async function currentPage(name: string): Promise<Page> {
  const context = await registry.spawn(name);
  return context.pages().at(-1) ?? await context.newPage();
}

/** What the agent "sees": URL, title and the accessibility snapshot with [ref=eN] markers. */
async function describe(name: string, page: Page): Promise<string> {
  const snapshot = await page.ariaSnapshot({ mode: 'ai' });
  return `Actor: ${name}\nURL: ${page.url()}\nTitle: ${await page.title()}\n\nSnapshot:\n${snapshot}`;
}

/**
 * Find the element for a ref, failing immediately if it isn't on the current page.
 * Without this check, Playwright would wait for it to appear until the action times out (30s).
 */
async function byRef(page: Page, ref: string) {
  const locator = page.getByRef(ref);
  if (await locator.count() === 0) {
    throw new Error(`Ref "${ref}" is not on the current page (${page.url()}). Call browser_snapshot for fresh refs.`);
  }
  return locator;
}

/**
 * Turn what the agent passed into a full URL. Full URLs are used as-is; paths like "/login"
 * are joined to the CURRENT base URL. Resolving here (instead of relying on the baseURL each
 * context got when it was created) means browser_set_base_url also affects actors already open.
 */
function resolveUrl(url: string): string {
  return new URL(url, registry.getSettings().baseURL).href;
}

/** MCP tool results are a list of content blocks; we only return text. */
function text(value: string) {
  return { content: [{ type: 'text' as const, text: value }] };
}

/** Turn a thrown error into a tool result the agent can read and react to, instead of crashing. */
function failure(err: unknown) {
  return { ...text(`Error: ${err instanceof Error ? err.message.split('\n')[0] : String(err)}`), isError: true };
}

// ---------------------------------------------------------------- tools

server.registerTool('browser_set_base_url', {
  description: 'Choose which website relative paths point to, e.g. "http://localhost:5173" or "https://staging.example.com". ' +
    'Applies to every actor, including ones already open. Logins are per website, so actors may need to log in again.',
  inputSchema: { baseURL: z.url().describe('Root address of the website, e.g. "http://localhost:5173"') },
}, async ({ baseURL }) => {
  const previous = registry.getSettings().baseURL;
  registry.configure({ baseURL });
  return text(`Base URL changed from ${previous} to ${baseURL}. Paths like "/login" now open ${resolveUrl('/login')}.`);
});

server.registerTool('browser_open', {
  description: 'Open a URL as the given actor. A full URL ("http://localhost:5173/login") opens that site directly; ' +
    'a path ("/login") uses the current base URL (see browser_actors, change with browser_set_base_url). Returns a page snapshot.',
  inputSchema: { actor, url: z.string().describe('Path ("/login") or full URL') },
}, async ({ actor, url }) => {
  try {
    const page = await currentPage(actor);
    const response = await page.goto(resolveUrl(url));
    return text(`HTTP ${response?.status() ?? 'no response'}\n${await describe(actor, page)}`);
  } catch (err) {
    return failure(err);
  }
});

server.registerTool('browser_snapshot', {
  description: 'Show what the actor currently sees: URL, title, and elements with refs to use in click/fill.',
  inputSchema: { actor },
}, async ({ actor }) => {
  try {
    return text(await describe(actor, await currentPage(actor)));
  } catch (err) {
    return failure(err);
  }
});

server.registerTool('browser_click', {
  description: 'Click an element as the given actor. Use a ref from the latest snapshot. Returns the new snapshot.',
  inputSchema: { actor, ref: z.string().describe('Element ref from the latest snapshot, e.g. "e5" or "f1e6"') },
}, async ({ actor, ref }) => {
  try {
    const page = await currentPage(actor);
    await (await byRef(page, ref)).click();
    await page.waitForLoadState(); // if the click started a navigation, wait for the new page
    return text(await describe(actor, await currentPage(actor))); // re-read: the click may have opened a popup
  } catch (err) {
    return failure(err);
  }
});

server.registerTool('browser_fill', {
  description: 'Type into an input as the given actor, replacing its contents. Use a ref from the latest snapshot.',
  inputSchema: {
    actor,
    ref: z.string().describe('Element ref of the input, e.g. "e3" or "f1e3"'),
    value: z.string().describe('Text to type'),
  },
}, async ({ actor, ref, value }) => {
  try {
    const page = await currentPage(actor);
    await (await byRef(page, ref)).fill(value);
    return text(`Filled ${ref}.\n${await describe(actor, page)}`);
  } catch (err) {
    return failure(err);
  }
});

server.registerTool('browser_actors', {
  description: 'Show the current base URL, the open actors and the URL of each one\'s tabs.',
  inputSchema: {},
}, async () => {
  const lines = registry.names().map(name =>
    `${name}: ${registry.pages(name).map(p => p.url()).join(', ') || '(no tabs)'}`);
  return text(`Base URL: ${registry.getSettings().baseURL}\n` +
    (lines.join('\n') || 'No actors open yet. Use browser_open with any actor name.'));
});

server.registerTool('browser_close', {
  description: 'Close an actor\'s browser context (its tabs and login). Using the name again starts fresh.',
  inputSchema: { actor },
}, async ({ actor }) => {
  await registry.remove(actor);
  return text(`Closed ${actor}.`);
});

// ---------------------------------------------------------------- start

await server.connect(new StdioServerTransport());
console.error('multi-role-browser MCP server ready'); // stderr: safe

// When the agent disconnects (stdin closes) or the process is stopped, close Chromium too,
// so no browser processes are left running.
async function shutdown(): Promise<void> {
  await registry.closeAll();
  process.exit(0);
}
process.stdin.on('close', shutdown);
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
