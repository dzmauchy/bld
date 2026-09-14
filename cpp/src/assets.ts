export class ToolchainAssets {
  constructor(
    readonly clangWasm: string,
    readonly lldWasm: string,
    readonly sysroot: string,
  ) {}

  static fromBase(base = "/toolchain"): ToolchainAssets {
    const prefix = base.replace(/\/$/, "");
    return new ToolchainAssets(
      `${prefix}/clang.wasm`,
      `${prefix}/lld.wasm`,
      `${prefix}/sysroot.tgz`,
    );
  }
}
