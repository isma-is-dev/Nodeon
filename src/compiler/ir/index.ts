export { lowerToIR } from "./ir-lower";
export { optimizeIR, eliminateDeadCode } from "./ir-optimize";
export { emitIR } from "./ir-emit";
export type {
  IRModule, IRFunction, IRBlock, IRInstruction, IRValue, IRTerminator,
} from "./ir-nodes";
