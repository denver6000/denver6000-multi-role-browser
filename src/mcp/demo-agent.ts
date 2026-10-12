// A scripted stand-in for an AI agent, to show how a client drives the MCP server.
//
// Claude Code does exactly this: start the server as a child process, list its tools,
// and call them. The difference is that here the "decisions" (which ref to click) are
// made with a regex over the snapshot text instead of by a language model.
//
// Run (with the dummy site running):  npm run demo:agent
// Add --visible to watch the browser windows.

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
for (const tool of tools) console.log(`  ${tool.name.padEnd(17)} ${tool.description}`);

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

// A mistake the agent can recover from: a stale ref comes back as an error result, not a crash.
console.log('\nClicking a ref that does not exist:', await call('browser_click', { actor: 'user', ref: 'e999' }).catch(e => String(e)));

console.log('\nbrowser_actors:\n' + await call('browser_actors'));

if (visible) await new Promise(resolve => setTimeout(resolve, 5000));
await client.close(); // closes the server's stdin -> it shuts Chromium down
