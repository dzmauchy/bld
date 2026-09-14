declare module "clang-emscripten" {
  const createModule: import("./emscripten.ts").EmscriptenModuleFactory;
  export default createModule;
}

declare module "lld-emscripten" {
  const createModule: import("./emscripten.ts").EmscriptenModuleFactory;
  export default createModule;
}
