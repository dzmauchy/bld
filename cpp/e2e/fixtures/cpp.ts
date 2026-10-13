import { expect } from "vitest";
import type { Page, WebWorker } from "puppeteer";
import { browserTest, baseURL, element } from "../../../tests/e2e/browser.ts";
import { ClangDumpResult, type ClangAstDumper } from "cpp/clangAstDumper.ts";
import type { CppPageApi } from "cpp/browser/api.ts";

declare global {
  interface Window {
    cpp: CppPageApi;
  }
}

/** A page owns the clang/lld worker across tests; each compile loads fresh program state. */
export class CppSession {
  private readonly workers: WebWorker[] = [];
  readonly astDumper: ClangAstDumper;

  constructor(private readonly page: Page) {
    page.on("workercreated", (worker) => this.workers.push(worker));
    this.astDumper = {
      dump() { throw new Error("Browser AST dumps are asynchronous"); },
      async dumpAsync(files, mainFile) {
        const result = await page.evaluate(
          ({ files, mainFile }) => window.cpp.dumpAst(files, mainFile),
          { files: Object.fromEntries(files), mainFile },
        );
        return new ClangDumpResult(result.ok, result.ast, result.stdout, result.stderr);
      },
    };
  }

  private _pageReadyDurationMs = 0;

  get pageReadyDurationMs(): number {
    return this._pageReadyDurationMs;
  }

  async open(baseURL: string): Promise<void> {
    const start = performance.now();
    await this.page.goto(baseURL);
    await expect.poll(() => element(this.page, "#status").text()).toBe("module-ready");
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

const sessionTest = browserTest().extend("cppSession", { scope: "file" }, async ({ browser }, { onCleanup }) => {
  const page = await browser.newPage();
  const session = new CppSession(page);
  try {
    await session.open(baseURL());
  } catch (error) {
    await page.close();
    throw error;
  }
  onCleanup(() => session.close());
  return session;
});

export const test = sessionTest.extend("cpp", async ({ cppSession }, { onCleanup }) => {
  onCleanup(() => cppSession.expectWorkersReused());
  return cppSession;
});

export { expect };
