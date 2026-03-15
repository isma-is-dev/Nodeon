// ── Compile to WebAssembly ───────────────────────────────────────────
// High-level API: .no source → WASM binary or WAT text.

import { compileToAST } from "@compiler/compile";
import { lowerToIR, optimizeIR, eliminateDeadCode } from "@compiler/ir/index";
import { emitWasm } from "@compiler/ir/ir-emit-wasm";
import { compileIRToWasmBinary, compileIRToWasmDesc } from "@compiler/ir/ir-compile-wasm";
import type { IRModule } from "@compiler/ir/ir-nodes";
import type { WasmEmitResult } from "@compiler/ir/ir-emit-wasm";

export interface WasmCompileResult {
  wasm: Uint8Array;
  wat: string;
  exports: string[];
  ir: IRModule;
}

export function compileToWasm(source: string): WasmCompileResult {
  const ast = compileToAST(source);
  const ir = lowerToIR(ast);
  let optimized = optimizeIR(ir);
  optimized = eliminateDeadCode(optimized);

  // Generate WAT text
  const watResult: WasmEmitResult = emitWasm(optimized);

  // Generate WASM binary
  const wasm = compileIRToWasmBinary(optimized);

  return {
    wasm,
    wat: watResult.wat,
    exports: watResult.exports,
    ir: optimized,
  };
}

export function compileToWat(source: string): string {
  const ast = compileToAST(source);
  const ir = lowerToIR(ast);
  let optimized = optimizeIR(ir);
  optimized = eliminateDeadCode(optimized);
  return emitWasm(optimized).wat;
}
