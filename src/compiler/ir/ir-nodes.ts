// ── IR Node Definitions ─────────────────────────────────────────────
// Intermediate representation between AST and JS code generation.
// Enables optimization passes (constant folding, dead code elimination).

export type IRModule = {
  type: "IRModule";
  functions: IRFunction[];
  globals: IRInstruction[];
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
};

export type IRJump = {
  op: "jump";
  target: string;
};
