// A scripted stand-in for an AI agent, to show how a client drives the MCP server.
//
// Claude Code does exactly this: start the server as a child process, list its tools,
// and call them. The difference is that here the "decisions" (which ref to click) are
// made with a regex over the snapshot text instead of by a language model.
//
// Run (with the dummy site running):  npm run demo:agent
// Add --visible to watch the browser windows.

import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const visible = process.argv.includes('--visible');

// 1. Start the server as a child process and connect to its stdin/stdout.
const env: Record<string, string> = {};
for (const [key, value] of Object.entries(process.env)) if (value !== undefined) env[key] = value;
if (!visible) env.HEADLESS = '1';

const transport = new StdioClientTransport({ command: process.execPath, args: ['src/mcp/server.ts'], env });
const client = new Client({ name: 'demo-agent', version: '0.1.0' });
await client.connect(transport);

// 2. Discover the tools, just as an agent does before its first call.
const { tools } = await client.listTools();
console.log('Tools offered by the server:');
for (const tool of tools) console.log(`  ${tool.name.padEnd(19)} ${tool.description}`);

/** Call a tool and return its text output. */
async function call(name: string, args: Record<string, string> = {}): Promise<string> {
  const result = await client.callTool({ name, arguments: args });
  const blocks = result.content as Array<{ type: string; text?: string }>;
  return blocks.map(b => b.text ?? '').join('\n');
}

/**
 * "Read" a snapshot and find the ref of an element, e.g. findRef(snap, 'button', 'Sign in').
 * Refs look like "e8" on the first page and gain a prefix after navigation, e.g. "f1e6".
 */
function findRef(snapshot: string, role: string, name: string): string {
  const match = new RegExp(`${role} "${name}"[^\\n]*\\[ref=([^\\]]+)\\]`).exec(snapshot);
  if (!match?.[1]) throw new Error(`No ${role} "${name}" in snapshot:\n${snapshot}`);
  return match[1];
}

/** Log in through the real form, choosing every ref from what the page shows. */
async function login(actor: string, email: string, password: string): Promise<string> {
  const page = await call('browser_open', { actor, url: '/login' });
  if (actor === 'admin') console.log(`\n--- What the agent sees after browser_open(admin, /login) ---\n${page}\n`);

  await call('browser_fill', { actor, ref: findRef(page, 'textbox', 'Email'), value: email });
  await call('browser_fill', { actor, ref: findRef(page, 'textbox', 'Password'), value: password });
  return call('browser_click', { actor, ref: findRef(page, 'button', 'Sign in') });
}

// 3. The scenario: two roles, side by side.
const adminHome = await login('admin', 'admin@test.local', 'admin123');
const userHome = await login('user', 'user@test.local', 'user123');
console.log('admin landed on:', /Welcome, [^\n"]+/.exec(adminHome)?.[0]);
console.log('user  landed on:', /Welcome, [^\n"]+/.exec(userHome)?.[0]);

console.log('admin dashboard has "Admin panel" link?', adminHome.includes('link "Admin panel"'));
console.log('user  dashboard has "Admin panel" link?', userHome.includes('link "Admin panel"'));

// The admin clicks the link it can see; the user tries the URL directly.
const adminPanel = await call('browser_click', { actor: 'admin', ref: findRef(adminHome, 'link', 'Admin panel') });
const userPanel = await call('browser_open', { actor: 'user', url: '/admin' });
console.log('admin /admin:', /Title: .*/.exec(adminPanel)?.[0]);
console.log('user  /admin:', /HTTP \d+/.exec(userPanel)?.[0], /Title: .*/.exec(userPanel)?.[0]);

// In-app navigation: the button fetches data and swaps the page without a page load. The snapshot
// browser_click returns must already show the new page, not the dashboard it started from.
const dashboard = await call('browser_open', { actor: 'user', url: '/' });
const profile = await call('browser_click', { actor: 'user', ref: findRef(dashboard, 'button', 'Open profile') });
console.log('\nuser after "Open profile":', /URL: .*/.exec(profile)?.[0], /Title: .*/.exec(profile)?.[0]);
if (!profile.includes('heading "Profile of Uma User"')) {
  await client.close();
  throw new Error(`browser_click returned before the in-app navigation finished:\n${profile}`);
}

// A screenshot comes back as an image block the agent can look at, next to a short text block.
const shotFile = path.join(os.tmpdir(), 'multi-role-browser-demo.png');
const shot = await client.callTool({ name: 'browser_screenshot', arguments: { actor: 'user', path: shotFile } });
const image = (shot.content as Array<{ type: string; data?: string; mimeType?: string }>).find(b => b.type === 'image');
if (shot.isError || !image?.data || !Buffer.from(image.data, 'base64').subarray(1, 4).equals(Buffer.from('PNG'))) {
  await client.close();
  throw new Error(`browser_screenshot did not return a PNG image:\n${JSON.stringify(shot.content).slice(0, 500)}`);
}
console.log(`\nuser screenshot: ${image.mimeType}, ${Buffer.from(image.data, 'base64').length} bytes, saved to ${shotFile}`);

// A mistake the agent can recover from: a stale ref comes back as an error result, not a crash.
console.log('\nClicking a ref that does not exist:', await call('browser_click', { actor: 'user', ref: 'e999' }).catch(e => String(e)));

console.log('\nbrowser_actors:\n' + await call('browser_actors'));

if (visible) await new Promise(resolve => setTimeout(resolve, 5000));
await client.close(); // closes the server's stdin -> it shuts Chromium down
