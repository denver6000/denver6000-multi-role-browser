import { chromium } from 'playwright';
import type { Browser, BrowserContext, Page } from 'playwright';

/**
 * Tracks named browser contexts ("admin", "user", ...) that share one browser.
 *
 * This module is a singleton: Node runs it once, so every file that imports it
 * shares the same browser and the same name -> context map.
 *
 * Playwright already tracks contexts and pages (browser.contexts(), context.pages()),
 * but it doesn't know their names. This module adds that.
 *
 * @example
 * import * as registry from './src/browser/registry.ts';
 *
 * registry.configure({ baseURL: 'http://localhost:3000' });
 * const admin = await registry.spawn('admin');
 * const page = await admin.newPage();
 * await page.goto('/admin');
 * await registry.closeAll();
 */

let browser: Browser | undefined;
const contexts = new Map<string, BrowserContext>();
const settings = {
  baseURL: 'http://localhost:3000', // root of the app under test; lets pages use paths like '/admin'
  headless: false,                  // false shows the browser windows
};

/**
 * Change settings. Affects contexts spawned afterwards; `headless` only applies
 * if the browser hasn't been launched yet.
 */
export function configure(options: Partial<typeof settings>): void {
  Object.assign(settings, options);
}

/** Current settings. A copy, so they can only be changed through configure(). */
export function getSettings(): Readonly<typeof settings> {
  return { ...settings };
}

/**
 * Get the context registered under `name`, creating it on first use.
 * The browser itself is launched the first time any context is spawned.
 *
 * Not safe for simultaneous calls with the same name: both could create a context.
 */
export async function spawn(name: string): Promise<BrowserContext> {
  const existing = contexts.get(name);
  if (existing) return existing;

  browser ??= await chromium.launch({ headless: settings.headless });
  const context = await browser.newContext({ baseURL: settings.baseURL });
  contexts.set(name, context);
  context.on('close', () => contexts.delete(name)); // stay in sync if it's closed elsewhere
  return context;
}

/** The context registered under `name`, or undefined if there isn't one. */
export function get(name: string): BrowserContext | undefined {
  return contexts.get(name);
}

/** Open tabs of `name`'s context (Playwright does the page tracking). Empty if not registered. */
export function pages(name: string): Page[] {
  return get(name)?.pages() ?? [];
}

/** Names of every registered context. */
export function names(): string[] {
  return [...contexts.keys()];
}

/** Close `name`'s context and all its tabs. The 'close' handler removes it from the registry. */
export async function remove(name: string): Promise<void> {
  await get(name)?.close();
}

/** Close the browser, which closes every context and tab with it. */
export async function closeAll(): Promise<void> {
  await browser?.close();
  browser = undefined;
  contexts.clear();
}
