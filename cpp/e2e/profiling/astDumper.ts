/** Instrumented ClangAstDumper subclass that records AST dump timings and payloads. */

import { BrowserClangAstDumper, type AstDumpClient } from "../../src/browserClangAstDumper.ts";
import type { ClangDumpResult } from "../../src/clangAstDumper.ts";

export interface AstDumpRecord {
  readonly callIndex: number;
  readonly mainFile: string;
  readonly fileCount: number;
  readonly mainFileSizeChars: number;
  readonly astJsonSizeChars: number;
  readonly durationMs: number;
  readonly ok: boolean;
}

export class ProfilingClangAstDumper extends BrowserClangAstDumper {
  private readonly _records: AstDumpRecord[] = [];

  constructor(
    compiler: AstDumpClient,
    private readonly onRecord?: (record: AstDumpRecord) => void,
  ) {
    super(compiler);
  }

  get records(): readonly AstDumpRecord[] {
    return this._records;
  }

  override async dumpAsync(files: Map<string, string>, mainFile: string): Promise<ClangDumpResult> {
    const start = performance.now();
    const mainFileContent = files.get(mainFile) ?? "";
    const result = await super.dumpAsync(files, mainFile);
    const durationMs = performance.now() - start;

    const astJsonSize = result.ast ? JSON.stringify(result.ast).length : 0;
    const record: AstDumpRecord = {
      callIndex: this._records.length + 1,
      mainFile,
      fileCount: files.size,
      mainFileSizeChars: mainFileContent.length,
      astJsonSizeChars: astJsonSize,
      durationMs,
      ok: result.ok,
    };

    this._records.push(record);
    this.onRecord?.(record);

    return result;
  }
}
