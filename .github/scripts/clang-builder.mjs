import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

function run(command, cwd = process.cwd(), extraEnv = {}) {
    // Normalize multiline template strings into a single executable command line
    const normalized = command
        .trim()
        .split("\n")
        .map((line) => line.trim().replace(/\\$/, ""))
        .filter(Boolean)
        .join(" ");

    console.log(`\n\x1b[36m>>> Running:\x1b[0m ${normalized} (in ${cwd})`);
    execSync(normalized, {
        cwd,
        stdio: "inherit",
        shell: "/bin/bash",
        env: { ...process.env, NINJA_STATUS: "[%f/%t %e] ", ...extraEnv },
    });
}

const cleanFlags = (str) => str.trim().split(/\s+/).join(" ");

const EMSDK = process.env.EMSDK;
if (!EMSDK) {
    throw new Error("EMSDK environment variable is not defined. Run source ./emsdk_env.sh first.");
}

const ROOT_DIR = process.cwd();
const LLVM_DIR = path.join(ROOT_DIR, "llvm-project");
const DIST_DIR = path.join(ROOT_DIR, "dist");
const STAGE_DIR = path.join(DIST_DIR, "sysroot");

// -------------------------------------------------------------
// 1. Prune Unwanted Emscripten Source Headers
// -------------------------------------------------------------
console.log("\n--- [1/5] Pruning Emscripten Headers ---");
const sysInc = path.join(EMSDK, "upstream/emscripten/system/include");
const dirsToPrune = [
    "AL", "EGL", "GL", "GLES", "GLES2", "GLES3", "GLFW", "KHR",
    "SDL", "X11", "fakesdl", "sanitizer", "scsi", "webgl"
];

for (const dir of dirsToPrune) {
    const target = path.join(sysInc, dir);
    if (fs.existsSync(target)) {
        fs.rmSync(target, { recursive: true, force: true });
    }
}

// -------------------------------------------------------------
// 2. Build Emscripten System Libraries
// -------------------------------------------------------------
console.log("\n--- [2/5] Building Emscripten System Libraries ---");
run(`
  embuilder build
    sysroot
    libc
    libc++
    libc++abi
    libdlmalloc
`);

// -------------------------------------------------------------
// 3. Stage 1 - Build Native TableGen Tools
// -------------------------------------------------------------
console.log("\n--- [3/5] Building Native TableGen Tools ---");
run(`
  cmake -G Ninja -B build-native -S llvm
    -DCMAKE_BUILD_TYPE=Release
    -DLLVM_ENABLE_PROJECTS="clang"
    -DCMAKE_C_COMPILER=clang
    -DCMAKE_CXX_COMPILER=clang++
    -DLLVM_USE_LINKER=lld
    -DLLVM_ENABLE_BINDINGS=OFF
`, LLVM_DIR);

run(`
  ninja -C build-native -j 4
    llvm-tblgen
    clang-tblgen
    llvm-min-tblgen
`, LLVM_DIR);

// -------------------------------------------------------------
// 4. Stage 2 - Build Clang and LLD to WebAssembly
// -------------------------------------------------------------
console.log("\n--- [4/5] Cross-Compiling Clang & LLD to Wasm ---");
const nativeBin = path.join(LLVM_DIR, "build-native", "bin");

const cxxFlags = cleanFlags(`
  -Oz
  -ffunction-sections
  -fdata-sections
  -fno-exceptions
  -fno-unwind-tables
  -fno-asynchronous-unwind-tables
  -fno-rtti
  -mbulk-memory
  -mextended-const
  -mtail-call
  -mmultivalue
  -msign-ext
  -mnontrapping-fptoint
  -mreference-types
`);

const cFlags = cleanFlags(`
  -Oz
  -ffunction-sections
  -fdata-sections
  -fno-unwind-tables
  -fno-asynchronous-unwind-tables
`);

const exeLinkerFlags = cleanFlags(`
  -Oz
  -Wl,--gc-sections
  -Wl,--compress-relocations
  -mbulk-memory
  -mextended-const
  -mtail-call
  -mmultivalue
  -msign-ext
  -mnontrapping-fptoint
  -mreference-types
  -sEVAL_CTORS=1
  -sALLOW_MEMORY_GROWTH=1
  -sINITIAL_MEMORY=256MB
  -sMAXIMUM_MEMORY=2GB
  -sFORCE_FILESYSTEM=1
  -sDISABLE_EXCEPTION_CATCHING=1
  -sTEXTDECODER=2
  -sEXPORTED_RUNTIME_METHODS=FS,callMain
  -sEXPORT_NAME=createModule
  -sMODULARIZE=1
  -sEXPORT_ES6=1
  -sENVIRONMENT=web,worker
  -sPOLYFILL=0
  -sGROWABLE_ARRAYBUFFERS=1
`);

run(`
  emcmake cmake -G Ninja -B build-wasm -S llvm
    -DCMAKE_BUILD_TYPE=MinSizeRel
    -DLLVM_ENABLE_PROJECTS="clang;lld"
    -DLLVM_TARGETS_TO_BUILD="WebAssembly"
    -DLLVM_DEFAULT_TARGET_TRIPLE="wasm32-unknown-emscripten"
    -DLLVM_NATIVE_TOOL_DIR="${nativeBin}"
    -DLLVM_ENABLE_THREADS=OFF
    -DLLVM_ENABLE_BACKTRACES=OFF
    -DLLVM_ENABLE_CRASH_OVERRIDES=OFF
    -DLLVM_ENABLE_LIBXML2=OFF
    -DLLVM_ENABLE_ZLIB=OFF
    -DLLVM_ENABLE_ZSTD=OFF
    -DLLVM_ENABLE_LIBPFM=OFF
    -DLLVM_ENABLE_PIC=OFF
    -DLLVM_ENABLE_UNWIND_TABLES=OFF
    -DLLVM_INSTALL_UTILS=OFF
    -DLLVM_ENABLE_PLUGINS=OFF
    -DLLVM_ENABLE_BINDINGS=OFF
    -DLLVM_INCLUDE_TESTS=OFF
    -DLLVM_INCLUDE_EXAMPLES=OFF
    -DLLVM_INCLUDE_BENCHMARKS=OFF
    -DLLVM_INCLUDE_DOCS=OFF
    -DLLVM_BUILD_TOOLS=OFF
    -DLLVM_BUILD_UTILS=OFF
    -DCLANG_ENABLE_STATIC_ANALYZER=OFF
    -DCLANG_ENABLE_OBJC_REWRITER=OFF
    -DCLANG_TOOL_C_INDEX_TEST_BUILD=OFF
    -DCLANG_ENABLE_HLSL=OFF
    -DCLANG_ENABLE_ARCMT=OFF
    -DCLANG_BUILD_TOOLS=ON
    -DDEFAULT_SYSROOT="/sysroot"
    -DCLANG_DEFAULT_CXX_STDLIB="libc++"
    -DCLANG_DEFAULT_RTLIB="compiler-rt"
    -DCLANG_DEFAULT_LINKER="lld"
    -DCMAKE_CXX_FLAGS="${cxxFlags}"
    -DCMAKE_C_FLAGS="${cFlags}"
    -DCMAKE_EXE_LINKER_FLAGS="${exeLinkerFlags}"
`, LLVM_DIR);

run(`
  ninja -C build-wasm -j 4
    clang
    lld
`, LLVM_DIR);

// -------------------------------------------------------------
// 5. Stage 3 - Optimize Binaries and Package Sysroot
// -------------------------------------------------------------
console.log("\n--- [5/5] Optimizing and Assembling Distribution ---");
fs.mkdirSync(DIST_DIR, { recursive: true });
const wasmBinDir = path.join(LLVM_DIR, "build-wasm", "bin");

// Resolve binary paths
const wasmOptCandidates = [
    path.join(EMSDK, "upstream/bin/wasm-opt"),
    path.join(EMSDK, "upstream/emscripten/bin/wasm-opt"),
];
const wasmOpt = wasmOptCandidates.find((p) => fs.existsSync(p)) || "wasm-opt";

const llvmStripCandidates = [path.join(EMSDK, "upstream/bin/llvm-strip")];
const llvmStrip = llvmStripCandidates.find((p) => fs.existsSync(p)) || "llvm-strip";

// 5.1 wasm-opt optimization
for (const tool of ["clang", "lld"]) {
    const srcWasm = path.join(wasmBinDir, `${tool}.wasm`);
    const srcJs = path.join(wasmBinDir, `${tool}.js`);
    const outWasm = path.join(DIST_DIR, `${tool}.wasm`);

    if (!fs.existsSync(srcWasm)) {
        throw new Error(`Expected output binary not found: ${srcWasm}`);
    }

    run(`
    ${wasmOpt}
      -Oz
      --converge
      --strip-debug
      --strip-producers
      --strip-target-features
      --reorder-functions
      -all "${srcWasm}"
      -o "${outWasm}"
  `);
    fs.copyFileSync(srcJs, path.join(DIST_DIR, `${tool}.js`));
}

// 5.2 Find sysroot & compiler resources
let emscriptenSysroot;
try {
    emscriptenSysroot = execSync("emcc --print-sysroot", { encoding: "utf8" }).trim();
} catch {
    emscriptenSysroot = path.join(EMSDK, "upstream/emscripten/cache/sysroot");
}

const findResourceDir = (basePaths) => {
    for (const base of basePaths) {
        if (fs.existsSync(base)) {
            const items = fs.readdirSync(base, { withFileTypes: true });
            const dir = items.find((entry) => entry.isDirectory());
            if (dir) return path.join(base, dir.name);
        }
    }
    return null;
};

const clangResSrc = findResourceDir([
    path.join(LLVM_DIR, "build-native/lib/clang"),
    path.join(LLVM_DIR, "build-wasm/lib/clang"),
]);

if (!clangResSrc) {
    throw new Error("Clang resource header directory not found!");
}

// 5.3 Assemble Clean Sysroot
const stageLibWasm = path.join(STAGE_DIR, "lib/wasm32-emscripten");
const stageLibClang = path.join(STAGE_DIR, "lib/clang");

fs.rmSync(STAGE_DIR, { recursive: true, force: true });
fs.mkdirSync(stageLibWasm, { recursive: true });
fs.mkdirSync(stageLibClang, { recursive: true });

// Copy include directory
fs.cpSync(path.join(emscriptenSysroot, "include"), path.join(STAGE_DIR, "include"), { recursive: true });

// Copy .a and .o files
const sysLibDir = path.join(emscriptenSysroot, "lib/wasm32-emscripten");
for (const file of fs.readdirSync(sysLibDir)) {
    if (file.endsWith(".a") || file.endsWith(".o")) {
        fs.copyFileSync(path.join(sysLibDir, file), path.join(stageLibWasm, file));
    }
}

// Strip debug info from static libraries
run(`
  ${llvmStrip}
    --strip-debug
    ${path.join(stageLibWasm, "*.{a,o}")}
`);

// Copy clang headers
const clangVer = path.basename(clangResSrc);
fs.cpSync(clangResSrc, path.join(stageLibClang, clangVer), { recursive: true });

// 5.4 Prune unused headers and static libraries
const clangHeadersPath = path.join(stageLibClang, clangVer, "include");
if (fs.existsSync(clangHeadersPath)) {
    const prunePatterns = /(intrin|arm|riscv|altivec|cpuid|cuda|hip|spirv|hexagon|opencl)/i;
    for (const file of fs.readdirSync(clangHeadersPath)) {
        if (prunePatterns.test(file)) {
            fs.rmSync(path.join(clangHeadersPath, file), { recursive: true, force: true });
        }
    }
}

const libPruneRegex = new RegExp(`^(${[
    "lib(GL.*|al|html5|fetch.*|stb_image|sockets.*|jsmath|openmp|wasm_workers.*|embind.*|emmalloc.*|mimalloc.*|llvmlibc.*|wasmfs.*|standalonewasm-.*)\\.a",
    ".*-(mt|ww|debug|tracing|asan|ubsan.*|lsan.*|legacyexcept|legacysjlj|wasmsjlj).*\\.a",
    "libclang_rt\\.(asan.*|ubsan.*|lsan.*|sanitizer_common.*)\\.a",
].join("|")})$`);

for (const file of fs.readdirSync(stageLibWasm)) {
    if (libPruneRegex.test(file)) {
        fs.unlinkSync(path.join(stageLibWasm, file));
    }
}

// 5.5 Package sysroot archive
const sysrootArchive = path.join(DIST_DIR, "sysroot.tgz");
run(`
  tar
    --sort=name
    -I 'gzip -9'
    -cf "${sysrootArchive}"
    -C "${DIST_DIR}"
    sysroot
`);
fs.rmSync(STAGE_DIR, { recursive: true, force: true });

console.log("\n\x1b[32mBuild finished successfully. Artifacts ready in dist/:\x1b[0m");
for (const item of fs.readdirSync(DIST_DIR)) {
    const stat = fs.statSync(path.join(DIST_DIR, item));
    console.log(` - ${item} (${(stat.size / 1024 / 1024).toFixed(2)} MB)`);
}