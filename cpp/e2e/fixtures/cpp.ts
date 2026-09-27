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

  async warmup(baseURL: string): Promise<void> {
    await this.page.goto(baseURL);
    await expect(this.page.locator("#status")).toHaveText("module-ready");
    await this.page.evaluate(() => window.cpp.warmup());
    await expect(this.page.locator("#status")).toHaveText("ready");
    expect(this.workers).toHaveLength(2);
  }

  async compile(files: Map<string, string>): Promise<void> {
    await this.page.evaluate((files) => window.cpp.compile(files), Object.fromEntries(files));
  }

  invoke(name: string, args: number[] = []): Promise<number> {
    return this.page.evaluate(({ name, args }) => window.cpp.invoke(name, args), { name, args });
  }

  async expectWorkersReused(): Promise<void> {
    expect(this.workers).toHaveLength(2);
    expect(this.page.workers()).toEqual(this.workers);
    expect(await this.page.evaluate(() => window.cpp.workerCreateCount())).toBe(2);
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
      await session.warmup(baseURL);
      await use(session);
    } finally {
      await session.close();
    }
  }, { scope: "worker" }],
});

export { expect };
