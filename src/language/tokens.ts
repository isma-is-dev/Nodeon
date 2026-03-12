export enum TokenType {
  Identifier = "Identifier",
  Number = "Number",
  String = "String",
  RawString = "RawString",
  TemplateLiteral = "TemplateLiteral",
  Keyword = "Keyword",
  Operator = "Operator",
  Delimiter = "Delimiter",
  EOF = "EOF",
}

export interface SourceLocation {
  line: number;
  column: number;
  offset: number;
}

export interface Token {
  type: TokenType;
  value: string;
  position: number;
  loc: SourceLocation;
}