export class ToolchainAssets {
  constructor(
    readonly clangJs: string,
    readonly clangWasm: string,
    readonly lldJs: string,
    readonly lldWasm: string,
    readonly sysroot: string,
  ) {}

  static fromBase(base = "/toolchain"): ToolchainAssets {
    const prefix = base.replace(/\/$/, "");
    return new ToolchainAssets(
      `${prefix}/clang.js`,
      `${prefix}/clang.wasm`,
      `${prefix}/lld.js`,
      `${prefix}/lld.wasm`,
      `${prefix}/sysroot.tgz`,
    );
  }
}
