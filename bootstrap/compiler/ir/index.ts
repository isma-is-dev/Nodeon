export { lowerToIR, setListMethodParser } from "./ir-lower";
import { lowerToIR, setListMethodParser } from "./ir-lower";
import { Lexer } from "../lexer/lexer";
import { Parser } from "../parser/parser";
import type { Program } from "@ast/nodes";
import type { IRModule } from "./ir-nodes";

/**
 * BUG-WASM-77. Lower a program **for the WebAssembly backend**.
 *
 * **The lowering is shared, and some refusals are not.** A rule about what the WASM
 * emitter can type — a number written into a string — is not a fact about the language,
 * and pushing it from the shared pass stopped the JavaScript backend from compiling code
 * it had always compiled correctly. `lowerToIR` therefore takes the target, and this is
 * the named way to say it, so a WASM caller says so in one place instead of every rule
 * guessing which backend it is talking to.
 */
export function lowerToWasmIR(ast: Program): IRModule {
  return lowerToIR(ast, { wasm: true });
}

// The list methods are written in Nodeon and parsed here, once, so the lowering
// reads them as source instead of as hand-built bytecode. Doing it in this file
// keeps the dependency pointing one way: the lowering does not import the parser.
setListMethodParser((source: string) => {
  const parser = new Parser(new Lexer(source).tokenize(), source);
  const ast = parser.parseProgram();
  return { ...ast, errors: parser.errors };
});
export { optimizeIR, eliminateDeadCode } from "./ir-optimize";
export { emitIR } from "./ir-emit";
export { emitWasm } from "./ir-emit-wasm";
export { compileIRToWasmBinary, compileIRToWasmDesc } from "./ir-compile-wasm";
export { encodeWasmModule, OP } from "./wasm-binary";
export type {
  IRModule, IRFunction, IRBlock, IRInstruction, IRValue, IRTerminator,
} from "./ir-nodes";
export type { WasmEmitResult } from "./ir-emit-wasm";
export type { WasmModuleDesc, WasmFunc, WasmFuncType, WasmValType } from "./wasm-binary";
