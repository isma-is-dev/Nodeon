import { Program } from "@ast/nodes";
import { compileToAST, CompileOptions } from "@compiler/compile";
import { lowerToIR, optimizeIR, eliminateDeadCode, emitIR } from "@compiler/ir/index";
import type { IRModule } from "@compiler/ir/index";

export interface IRCompileResult {
  ir: IRModule;
  optimizedIR: IRModule;
  js: string;
  ast: Program;
}

export function compileWithIR(source: string, options: CompileOptions = {}): IRCompileResult {
  const ast = compileToAST(source);
  const ir = lowerToIR(ast);
  let optimizedIR = optimizeIR(ir);
  optimizedIR = eliminateDeadCode(optimizedIR);
  const js = emitIR(optimizedIR, options.minify ?? false);
  return { ir, optimizedIR, js, ast };
}

export { lowerToIR, optimizeIR, eliminateDeadCode, emitIR } from "@compiler/ir/index";
export type { IRModule, IRFunction, IRBlock, IRInstruction, IRValue, IRTerminator } from "@compiler/ir/index";
