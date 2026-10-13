import { CppWasmCompiler } from "../compiler.ts";
import { compilerHandler } from "./compiler.ts";
import { attachWorker } from "./host.ts";

attachWorker(compilerHandler(new CppWasmCompiler()));
