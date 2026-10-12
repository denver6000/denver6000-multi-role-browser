import { chromium } from 'playwright';
import type { BrowserContext, Page, Response } from 'playwright';

export async function makeInstance(baseURL: string, headless = false): Promise<BrowserContext> {
    const browser = await chromium.launch({ headless });
    const context = await browser.newContext({ baseURL });
    return context
}

export async function makePage(context: BrowserContext): Promise<Page> {
    return await context.newPage()
}

export async function openEndpoint(page: Page, path: string): Promise<Response | null> {
    const response = await page.goto(path);
    return response
}
