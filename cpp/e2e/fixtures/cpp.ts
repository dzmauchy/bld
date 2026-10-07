import { expect, test as base, type Page, type Worker } from "@playwright/test";
import { BrowserClangAstDumper } from "../../src/browserClangAstDumper.ts";
import type { CppPageApi } from "../../src/browser/api.ts";

declare global {
  interface Window {
    cpp: CppPageApi;
  }
}

/** A page owns the clang/lld worker across tests; each compile loads fresh program state. */
export class CppSession {
  private readonly workers: Worker[] = [];
  readonly astDumper: BrowserClangAstDumper;

  constructor(private readonly page: Page) {
    page.on("worker", (worker) => this.workers.push(worker));
    this.astDumper = new BrowserClangAstDumper({
      dumpAst: (files, mainFile) => page.evaluate(
        ({ files, mainFile }) => window.cpp.dumpAst(files, mainFile),
        { files: Object.fromEntries(files), mainFile },
      ),
    });
  }

  private _pageReadyDurationMs = 0;

  get pageReadyDurationMs(): number {
    return this._pageReadyDurationMs;
  }

  async open(baseURL: string): Promise<void> {
    const start = performance.now();
    await this.page.goto(baseURL);
    await expect(this.page.locator("#status")).toHaveText("module-ready");
    expect(this.workers).toHaveLength(0);
    expect(await this.page.evaluate(() => window.cpp.workerCreateCount())).toBe(0);
    this._pageReadyDurationMs = performance.now() - start;
  }

  async compile(files: Map<string, string>): Promise<void> {
    await this.page.evaluate((files) => window.cpp.compile(files), Object.fromEntries(files));
  }

  async compileOnly(files: Map<string, string>): Promise<number> {
    return this.page.evaluate((files) => window.cpp.compileOnly(files), Object.fromEntries(files));
  }

  async instantiateLast(): Promise<number> {
    return this.page.evaluate(() => window.cpp.instantiateLast());
  }

  get browserPage(): Page {
    return this.page;
  }

  invoke(name: string, args: number[] = []): Promise<number> {
    return this.page.evaluate(({ name, args }) => window.cpp.invoke(name, args), { name, args });
  }

  async expectWorkersReused(): Promise<void> {
    // The compiler and executor are each created on first use, then retained.
    expect(this.workers.length).toBeLessThanOrEqual(2);
    expect(this.page.workers()).toEqual(this.workers);
    expect(await this.page.evaluate(() => window.cpp.workerCreateCount())).toBe(this.workers.length);
  }

  async close(): Promise<void> {
    try {
      await this.page.evaluate(() => window.cpp.close());
    } finally {
      await this.page.close();
    }
  }
}

export const test = base.extend<{}, { cpp: CppSession }>({
  cpp: [async ({ browser }, use, workerInfo) => {
    const baseURL = workerInfo.project.use.baseURL;
    if (!baseURL) throw new Error("C++ tests require a baseURL");
    const page = await browser.newPage();
    const session = new CppSession(page);
    try {
      await session.open(baseURL);
      await use(session);
    } finally {
      await session.close();
    }
  }, { scope: "worker" }],
});

export { expect };
