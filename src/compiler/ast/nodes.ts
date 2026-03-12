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
  | ReturnStatement
  | ImportDeclaration
  | ExportDeclaration
  | ClassDeclaration
  | TryCatchStatement
  | ThrowStatement;

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
  constant: boolean;
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
};

export type ThrowStatement = {
  type: "ThrowStatement";
  value: Expression;
};

// ── Expressions ──────────────────────────────────────────────────────
export type Expression =
  | CallExpression
  | BinaryExpression
  | UnaryExpression
  | TemplateLiteral
  | Literal
  | Identifier
  | MemberExpression
  | ArrayExpression
  | ObjectExpression
  | ArrowFunction
  | AssignmentExpression
  | NewExpression
  | AwaitExpression
  | SpreadExpression
  | TernaryExpression;

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

export type MemberExpression = {
  type: "MemberExpression";
  object: Expression;
  property: Expression;
  computed: boolean; // true for obj[expr], false for obj.prop
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

export type Identifier = {
  type: "Identifier";
  name: string;
};

export type Literal = {
  type: "Literal";
  value: string | number | boolean | null;
  literalType: "string" | "number" | "boolean" | "null";
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
