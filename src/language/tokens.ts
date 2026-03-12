export enum TokenType {
  Identifier = "Identifier",
  Number = "Number",
  String = "String",
  Keyword = "Keyword",
  Operator = "Operator",
  Delimiter = "Delimiter",
  EOF = "EOF",
}

export interface Token {
  type: TokenType;
  value: string;
  position: number;
}