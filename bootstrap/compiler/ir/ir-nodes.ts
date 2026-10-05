// ── IR Node Definitions ─────────────────────────────────────────────
// Intermediate representation between AST and JS code generation.
// Enables optimization passes (constant folding, dead code elimination).

export type IRModule = {
  type: "IRModule";
  functions: IRFunction[];
  globals: IRInstruction[];
  /**
   * Which kind of value each array holds: "number" (f64 slots) or "address"
   * (i32 slots holding records). And which kind each `for` variable receives.
   * The emitter needs it to pick the right load, and guessing f64 for a record
   * address made `for o in records { t = t + o.v }` accumulate 0.
   */
  arrayKinds?: Record<string, "number" | "address">;
  loopVarKinds?: Record<string, "number" | "address">;
  /**
   * Names the CALLER knows hold a string, per function. STRING-SEED-75.
   *
   * `stringNames` is a fixpoint over the IR and can only learn a string from a
   * string literal, so a PARAMETER is never one of them — and the element width is
   * decided by exactly that set. A helper built from source is given its two
   * parameters here, because the caller is the only side that knows.
   */
  stringSeeds?: Record<string, string[]>;
  /**
   * Problems found while lowering, in the language of the source.
   *
   * A lambda that reads a name from the scope around it is a CLOSURE, and this
   * backend cannot make one yet. Reporting it here is the difference between a
   * program that says what is missing and one that quietly reads a global of the
   * same name and returns a plausible wrong number.
   */
  diagnostics?: string[];
};

export type IRFunction = {
  type: "IRFunction";
  name: string;
  params: string[];
  blocks: IRBlock[];
  async: boolean;
  generator: boolean;
};

export type IRBlock = {
  type: "IRBlock";
  label: string;
  instructions: IRInstruction[];
  terminator: IRTerminator | null;
};

// ── Instructions ────────────────────────────────────────────────────

export type IRInstruction =
  | IRAssign
  | IRBinOp
  | IRUnaryOp
  | IRCall
  | IRLoadField
  | IRStoreField
  | IRLiteral
  | IRDeclare
  | IRExprStmt;


export type IRAssign = {
  op: "assign";
  target: string;
  value: IRValue;
};

export type IRBinOp = {
  op: "binop";
  target: string;
  operator: string;
  left: IRValue;
  right: IRValue;
};

export type IRUnaryOp = {
  op: "unaryop";
  target: string;
  operator: string;
  argument: IRValue;
};

export type IRCall = {
  op: "call";
  target: string | null; // null if result unused
  callee: IRValue;
  args: IRValue[];
};

export type IRLoadField = {
  op: "loadfield";
  target: string;
  object: IRValue;
  field: string;
  computed: boolean;
};

export type IRStoreField = {
  op: "storefield";
  object: IRValue;
  field: string;
  value: IRValue;
};

export type IRLiteral = {
  op: "literal";
  target: string;
  value: any;
  kind: "number" | "string" | "boolean" | "null" | "undefined";
};

export type IRDeclare = {
  op: "declare";
  kind: "const" | "let" | "var";
  name: string;
  value: IRValue | null;
};

export type IRExprStmt = {
  op: "exprstmt";
  value: IRValue;
};

// ── Values (operands) ───────────────────────────────────────────────

export type IRValue =
  | { kind: "ref"; name: string }
  | { kind: "lit"; value: any; litType: string }
  | { kind: "temp"; id: string };

// ── Terminators (end of basic block) ────────────────────────────────

export type IRTerminator =
  | IRReturn
  | IRBranch
  | IRJump;

export type IRReturn = {
  op: "return";
  value: IRValue | null;
};

export type IRBranch = {
  op: "branch";
  condition: IRValue;
  thenLabel: string;
  elseLabel: string;
  /**
   * The label the ELSE ARM starts at, when there is one.
   *
   * `elseLabel` names the MERGE, so on its own it says nothing about where the
   * else arm is. The emitter used to infer that from POSITION — the else arm
   * begins one block after the last block of the then arm — and position is not
   * knowable: an arm holding a nested `if` ends at the nested arm's jump, not at
   * the end of the outer arm. So the emitter read a block from the MIDDLE of the
   * then arm as the else arm, emitted it a second time, and the code after a
   * nested `if` inside a `case` ran when the case did not match.
   *
   * The lowering knows the label because it is the one that created the block.
   * An arm that runs to the merge is expressed by naming the merge.
   */
  elseArm?: string;
  /**
   * Set on the FIRST branch of a `switch` chain, and only there: the label every
   * case body and every `break` leaves to.
   *
   * A `switch` lowers to the same chain of comparisons an `if`/`else if` does,
   * and the chain needs nothing extra — what it lacks is a TARGET for the jump
   * that leaves a case. In wasm a jump out is a `br` to the Nth enclosing
   * construct, and with no `block` around the chain that construct is the case's
   * own `if`. So the emitter has to know which branch opens a `switch`, and the
   * exit label is what lets a `break` two levels down find the right depth.
   *
   * It is a field rather than a `swend_` label prefix because the emitter
   * already reasons about block GRAPH, and a name it has to pattern-match is a
   * second, silent copy of the same fact.
   */
  switchExit?: string;
};

export type IRJump = {
  op: "jump";
  target: string;
};
