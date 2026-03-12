export type Program = {
  type: "Program";
  body: Statement[];
};

export type Statement = FunctionDeclaration | VariableDeclaration | ExpressionStatement;

export type FunctionDeclaration = {
  type: "FunctionDeclaration";
  name: Identifier;
  params: Identifier[];
  body: Statement[];
};

export type VariableDeclaration = {
  type: "VariableDeclaration";
  name: Identifier;
  value: Expression;
};

export type ExpressionStatement = {
  type: "ExpressionStatement";
  expression: Expression;
};

export type Expression = CallExpression | BinaryExpression | TemplateLiteral | Literal | Identifier;

export type CallExpression = {
  type: "CallExpression";
  callee: Identifier;
  arguments: Expression[];
};

export type BinaryExpression = {
  type: "BinaryExpression";
  operator: string;
  left: Expression;
  right: Expression;
};

export type Identifier = {
  type: "Identifier";
  name: string;
};

export type Literal = {
  type: "Literal";
  value: string | number;
  literalType: "string" | "number";
};

export type TemplatePartText = {
  kind: "Text";
  value: string;
};

export type TemplatePartExpression = {
  kind: "Expression";
  expression: Identifier;
};

export type TemplateLiteral = {
  type: "TemplateLiteral";
  parts: Array<TemplatePartText | TemplatePartExpression>;
};
