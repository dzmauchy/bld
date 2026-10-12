import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import puppeteer, { type Page, type ElementHandle, type KeyInput } from "puppeteer";
import { expect, inject, test as base } from "vitest";

export { expect };
export type { Page };
export const wasmBrowserArgs = [
  "--enable-experimental-webassembly-features",
  "--js-flags=--wasm-custom-descriptors,--wasm-compact-imports,--experimental-wasm-compact-imports,--wasm-staging",
];

export function browserTest(stock = false) {
  return base.extend("browser", { scope: "file" }, async ({}, { onCleanup }) => {
    const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage", ...(stock ? [] : wasmBrowserArgs)] });
    onCleanup(() => browser.close());
    return browser;
  }).extend("page", async ({ browser, task }, { onCleanup }) => {
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    page.setDefaultTimeout(30_000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    onCleanup(async () => {
      if (task.result?.state === "fail" && !page.isClosed()) {
        await page.screenshot({ path: artifactPath("failure.png") });
        writeFileSync(artifactPath("page-errors.txt"), errors.join("\n"));
      }
      await context.close();
    });
    return page;
  });
}

export function baseURL(): string { return inject("baseURL"); }
export function fetchAsset(path: string): Promise<Response> { return fetch(new URL(path, baseURL())); }
export function artifactPath(name: string): string {
  const title = (expect.getState().currentTestName ?? "browser").replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 180);
  const directory = join(inject("artifactDir"), title);
  mkdirSync(directory, { recursive: true });
  return join(directory, name);
}

/** A scoped DOM query using Puppeteer's shadow-piercing selectors and native input. */
export class BrowserElement {
  constructor(private readonly page: Page, readonly selector: string, private readonly index?: number) {}

  within(selector: string): BrowserElement { return new BrowserElement(this.page, `${this.selector} ${selector}`); }
  shadow(selector: string): BrowserElement { return new BrowserElement(this.page, `${this.selector} >>> ${selector}`); }
  first(): BrowserElement { return this.nth(0); }
  nth(index: number): BrowserElement { return new BrowserElement(this.page, this.selector, index); }

  private async handle(): Promise<ElementHandle<Element>> {
    await expect.poll(() => this.count(), { timeout: 30_000 }).toBeGreaterThan(0);
    const handles = await this.page.$$(this.selector);
    const selected = handles[this.index ?? 0];
    await Promise.all(handles.filter((handle) => handle !== selected).map((handle) => handle.dispose()));
    if (!selected) throw new Error(`Missing element: ${this.selector}`);
    return selected;
  }

  async evaluate<R>(callback: (element: Element) => R | Promise<R>): Promise<Awaited<R>> {
    const handle = await this.handle();
    try { return await handle.evaluate(callback); } finally { await handle.dispose(); }
  }

  async evaluateAll<R>(callback: (elements: Element[]) => R | Promise<R>): Promise<Awaited<R>> {
    return this.page.$$eval(this.selector, callback);
  }

  async count(): Promise<number> {
    const handles = await this.page.$$(this.selector);
    const count = this.index === undefined ? handles.length : Number(Boolean(handles[this.index]));
    await Promise.all(handles.map((handle) => handle.dispose()));
    return count;
  }

  async visible(): Promise<boolean> {
    if (!await this.count()) return false;
    const handle = await this.handle();
    try { return await handle.isVisible(); } finally { await handle.dispose(); }
  }

  async disabled(): Promise<boolean> { return this.evaluate((element) => element.matches(":disabled")); }
  async text(): Promise<string> { return this.evaluate((element) => (element.textContent ?? "").trim()); }
  async value(): Promise<string> { return this.evaluate((element) => (element as HTMLInputElement).value); }
  async getAttribute(name: string): Promise<string | null> {
    const handle = await this.handle();
    try { return await handle.evaluate((element, name) => element.getAttribute(name), name); } finally { await handle.dispose(); }
  }
  async boundingBox() {
    const handle = await this.handle();
    try { return await handle.boundingBox(); } finally { await handle.dispose(); }
  }
  async scrollIntoViewIfNeeded(): Promise<void> {
    const handle = await this.handle();
    try { if (!await handle.isIntersectingViewport({ threshold: 1 })) await handle.scrollIntoView(); } finally { await handle.dispose(); }
  }
  async click(options: { position?: { x: number; y: number }; modifiers?: KeyInput[] } = {}): Promise<void> {
    const handle = await this.handle();
    for (const key of options.modifiers ?? []) await this.page.keyboard.down(key);
    try {
      if (options.position) {
        let box = await handle.boundingBox();
        const viewport = this.page.viewport();
        if (box && viewport && (box.x + options.position.x < 0 || box.x + options.position.x >= viewport.width
          || box.y + options.position.y < 0 || box.y + options.position.y >= viewport.height)) {
          await handle.scrollIntoView();
          box = await handle.boundingBox();
        }
        if (!box) throw new Error(`Invisible element: ${this.selector}`);
        await this.page.mouse.click(box.x + options.position.x, box.y + options.position.y);
      } else await handle.click();
    } finally {
      for (const key of options.modifiers ?? []) await this.page.keyboard.up(key);
      await handle.dispose();
    }
  }
  async fill(text: string): Promise<void> { await this.page.locator(this.selector).fill(text); }
  async focus(): Promise<void> {
    const handle = await this.handle();
    try { await handle.focus(); } finally { await handle.dispose(); }
  }
  async press(key: KeyInput): Promise<void> { await this.focus(); await this.page.keyboard.press(key); }
  async dragTo(target: BrowserElement): Promise<void> {
    const from = await this.boundingBox();
    const to = await target.boundingBox();
    if (!from || !to) throw new Error("Drag endpoints must be visible");
    await this.page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await this.page.mouse.down();
    await this.page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 });
    await this.page.mouse.up();
  }
}

export function element(page: Page, selector: string): BrowserElement { return new BrowserElement(page, selector); }
export function dialog(page: Page, name: string): BrowserElement {
  return element(page, `wa-dialog[label=${JSON.stringify(name)}] >>> dialog`);
}

declare module "vitest" {
  export interface ProvidedContext { baseURL: string; artifactDir: string; }
}
