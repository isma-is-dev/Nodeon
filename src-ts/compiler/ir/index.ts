export { lowerToIR } from "./ir-lower";
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
