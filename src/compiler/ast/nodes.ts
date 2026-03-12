// ── Program ──────────────────────────────────────────────────────────
export type Program = {
  type: "Program";
  body: Statement[];
};

// ── Statements ───────────────────────────────────────────────────────
export type Statement =
  | FunctionDeclaration
  | VariableDeclaration
  | ExpressionStatement
  | IfStatement
  | ForStatement
  | WhileStatement
  | DoWhileStatement
  | ReturnStatement
  | ImportDeclaration
  | ExportDeclaration
  | ClassDeclaration
  | TryCatchStatement
  | ThrowStatement
  | SwitchStatement
  | BreakStatement
  | ContinueStatement
  | DebuggerStatement;

export type FunctionDeclaration = {
  type: "FunctionDeclaration";
  name: Identifier;
  params: Param[];
  body: Statement[];
  async: boolean;
};

export type Param = {
  type: "Param";
  name: string;
  defaultValue?: Expression;
  rest?: boolean;
};

export type VariableDeclaration = {
  type: "VariableDeclaration";
  name: Identifier;
  value: Expression;
  kind: "let" | "const" | "var";
};

export type ExpressionStatement = {
  type: "ExpressionStatement";
  expression: Expression;
};

export type IfStatement = {
  type: "IfStatement";
  condition: Expression;
  consequent: Statement[];
  alternate: Statement[] | null;
};

export type ForStatement = {
  type: "ForStatement";
  variable: Identifier;
  iterable: Expression;
  body: Statement[];
};

export type WhileStatement = {
  type: "WhileStatement";
  condition: Expression;
  body: Statement[];
};

export type DoWhileStatement = {
  type: "DoWhileStatement";
  condition: Expression;
  body: Statement[];
};

export type ReturnStatement = {
  type: "ReturnStatement";
  value: Expression | null;
};

export type ImportDeclaration = {
  type: "ImportDeclaration";
  defaultImport: string | null;
  namedImports: string[];
  source: string;
};

export type ExportDeclaration = {
  type: "ExportDeclaration";
  declaration: Statement;
};

export type ClassDeclaration = {
  type: "ClassDeclaration";
  name: Identifier;
  superClass: Identifier | null;
  body: ClassMethod[];
};

export type ClassMethod = {
  type: "ClassMethod";
  name: Identifier;
  params: Param[];
  body: Statement[];
  async: boolean;
};

export type TryCatchStatement = {
  type: "TryCatchStatement";
  tryBlock: Statement[];
  catchParam: Identifier | null;
  catchBlock: Statement[];
  finallyBlock: Statement[] | null;
};

export type ThrowStatement = {
  type: "ThrowStatement";
  value: Expression;
};

export type SwitchStatement = {
  type: "SwitchStatement";
  discriminant: Expression;
  cases: SwitchCase[];
};

export type SwitchCase = {
  type: "SwitchCase";
  test: Expression | null; // null for default
  consequent: Statement[];
};

export type BreakStatement = {
  type: "BreakStatement";
};

export type ContinueStatement = {
  type: "ContinueStatement";
};

export type DebuggerStatement = {
  type: "DebuggerStatement";
};

// ── Expressions ──────────────────────────────────────────────────────
export type Expression =
  | CallExpression
  | BinaryExpression
  | UnaryExpression
  | UpdateExpression
  | TemplateLiteral
  | Literal
  | Identifier
  | MemberExpression
  | ArrayExpression
  | ObjectExpression
  | ArrowFunction
  | AssignmentExpression
  | CompoundAssignmentExpression
  | NewExpression
  | AwaitExpression
  | SpreadExpression
  | TernaryExpression
  | TypeofExpression
  | VoidExpression
  | DeleteExpression
  | YieldExpression;

export type CallExpression = {
  type: "CallExpression";
  callee: Expression;
  arguments: Expression[];
};

export type BinaryExpression = {
  type: "BinaryExpression";
  operator: string;
  left: Expression;
  right: Expression;
};

export type UnaryExpression = {
  type: "UnaryExpression";
  operator: string;
  argument: Expression;
};

export type UpdateExpression = {
  type: "UpdateExpression";
  operator: "++" | "--";
  argument: Expression;
  prefix: boolean;
};

export type MemberExpression = {
  type: "MemberExpression";
  object: Expression;
  property: Expression;
  computed: boolean;
  optional: boolean;
};

export type ArrayExpression = {
  type: "ArrayExpression";
  elements: Expression[];
};

export type ObjectExpression = {
  type: "ObjectExpression";
  properties: ObjectProperty[];
};

export type ObjectProperty = {
  type: "ObjectProperty";
  key: Identifier | Literal;
  value: Expression;
  shorthand: boolean;
};

export type ArrowFunction = {
  type: "ArrowFunction";
  params: Param[];
  body: Statement[] | Expression;
  async: boolean;
};

export type AssignmentExpression = {
  type: "AssignmentExpression";
  left: Expression;
  right: Expression;
};

export type CompoundAssignmentExpression = {
  type: "CompoundAssignmentExpression";
  operator: string;
  left: Expression;
  right: Expression;
};

export type NewExpression = {
  type: "NewExpression";
  callee: Expression;
  arguments: Expression[];
};

export type AwaitExpression = {
  type: "AwaitExpression";
  argument: Expression;
};

export type SpreadExpression = {
  type: "SpreadExpression";
  argument: Expression;
};

export type TernaryExpression = {
  type: "TernaryExpression";
  condition: Expression;
  consequent: Expression;
  alternate: Expression;
};

export type TypeofExpression = {
  type: "TypeofExpression";
  argument: Expression;
};

export type VoidExpression = {
  type: "VoidExpression";
  argument: Expression;
};

export type DeleteExpression = {
  type: "DeleteExpression";
  argument: Expression;
};

export type YieldExpression = {
  type: "YieldExpression";
  argument: Expression | null;
  delegate: boolean;
};

export type Identifier = {
  type: "Identifier";
  name: string;
};

export type Literal = {
  type: "Literal";
  value: string | number | boolean | null | undefined;
  literalType: "string" | "number" | "boolean" | "null" | "undefined";
};

export type TemplatePartText = {
  kind: "Text";
  value: string;
};

export type TemplatePartExpression = {
  kind: "Expression";
  expression: Expression;
};

export type TemplateLiteral = {
  type: "TemplateLiteral";
  parts: Array<TemplatePartText | TemplatePartExpression>;
};
