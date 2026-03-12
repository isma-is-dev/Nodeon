import { Token, TokenType } from "../language/tokens";
import {
  Program,
  Statement,
  FunctionDeclaration,
  VariableDeclaration,
  ExpressionStatement,
  Expression,
  CallExpression,
  BinaryExpression,
  Identifier,
  Literal,
  TemplateLiteral,
  TemplatePartText,
  TemplatePartExpression,
} from "../ast/nodes";

const PRECEDENCE: Record<string, number> = {
  "*": 2,
  "/": 2,
  "+": 1,
  "-": 1,
};

export class Parser {
  private tokens: Token[] = [];
  private current = 0;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  parseProgram(): Program {
    const body: Statement[] = [];
    while (!this.isAtEnd()) {
      body.push(this.parseStatement());
    }
    return { type: "Program", body };
  }

  private parseStatement(): Statement {
    const tok = this.peek();

    if (tok.type === TokenType.Keyword && tok.value === "fn") {
      return this.parseFunctionDeclaration();
    }

    if (tok.type === TokenType.Identifier) {
      const next = this.peekNext();
      if (next?.type === TokenType.Operator && next.value === "=") {
        return this.parseVariableDeclaration();
      }
    }

    return this.parseExpressionStatement();
  }

  private parseFunctionDeclaration(): FunctionDeclaration {
    this.consumeKeyword("fn");
    const name = this.consumeIdentifier("Expected function name");
    this.consumeDelimiter("(", "Expected '('");
    const params: Identifier[] = [];
    if (!this.checkDelimiter(")")) {
      do {
        params.push(this.consumeIdentifier("Expected parameter name"));
      } while (this.matchDelimiter(","));
    }
    this.consumeDelimiter(")", "Expected ')'");
    const body = this.parseBlock();
    return { type: "FunctionDeclaration", name, params, body };
  }

  private parseBlock(): Statement[] {
    this.consumeDelimiter("{", "Expected '{'");
    const statements: Statement[] = [];
    while (!this.checkDelimiter("}") && !this.isAtEnd()) {
      statements.push(this.parseStatement());
    }
    this.consumeDelimiter("}", "Expected '}'");
    return statements;
  }

  private parseVariableDeclaration(): VariableDeclaration {
    const name = this.consumeIdentifier("Expected variable name");
    this.consumeOperator("=", "Expected '=' in assignment");
    const value = this.parseExpression();
    return { type: "VariableDeclaration", name, value };
  }

  private parseExpressionStatement(): ExpressionStatement {
    const expression = this.parseExpression();
    return { type: "ExpressionStatement", expression };
  }

  private parseExpression(precedence = 0): Expression {
    let left = this.parsePrimary();

    while (this.matchOperatorWithPrecedence(precedence)) {
      const opToken = this.previous();
      const opPrecedence = PRECEDENCE[opToken.value] ?? 0;
      const right = this.parseExpression(opPrecedence);
      left = {
        type: "BinaryExpression",
        operator: opToken.value,
        left,
        right,
      } as BinaryExpression;
    }

    return left;
  }

  private parsePrimary(): Expression {
    const token = this.peek();

    if (token.type === TokenType.Identifier) {
      // Could be call or identifier
      if (this.peekNext()?.type === TokenType.Delimiter && this.peekNext()?.value === "(") {
        return this.parseCallExpression();
      }
      this.advance();
      return { type: "Identifier", name: token.value } as Identifier;
    }

    if (token.type === TokenType.Number) {
      this.advance();
      return { type: "Literal", value: Number(token.value), literalType: "number" } as Literal;
    }

    if (token.type === TokenType.String) {
      this.advance();
      return this.parseStringLiteral(token.value);
    }

    this.error(token, "Expected expression");
  }

  private parseCallExpression(): CallExpression {
    const calleeTok = this.consumeIdentifier("Expected callee name");
    this.consumeDelimiter("(", "Expected '('");
    const args: Expression[] = [];
    if (!this.checkDelimiter(")")) {
      do {
        args.push(this.parseExpression());
      } while (this.matchDelimiter(","));
    }
    this.consumeDelimiter(")", "Expected ')'");
    return { type: "CallExpression", callee: calleeTok, arguments: args };
  }

  private parseStringLiteral(raw: string): Literal | TemplateLiteral {
    if (!raw.includes("{")) {
      return { type: "Literal", value: raw, literalType: "string" } as Literal;
    }

    const parts: Array<TemplatePartText | TemplatePartExpression> = [];
    let buffer = "";
    let i = 0;
    while (i < raw.length) {
      if (raw[i] === "{" ) {
        // flush text
        if (buffer) {
          parts.push({ kind: "Text", value: buffer });
          buffer = "";
        }
        let j = i + 1;
        let ident = "";
        while (j < raw.length && raw[j] !== "}") {
          ident += raw[j];
          j++;
        }
        if (j >= raw.length) {
          throw new SyntaxError("Unterminated interpolation in string literal");
        }
        parts.push({ kind: "Expression", expression: { type: "Identifier", name: ident } });
        i = j + 1;
        continue;
      }
      buffer += raw[i];
      i++;
    }
    if (buffer) {
      parts.push({ kind: "Text", value: buffer });
    }
    return { type: "TemplateLiteral", parts } as TemplateLiteral;
  }

  private matchOperatorWithPrecedence(currentPrecedence: number): boolean {
    const tok = this.peek();
    if (tok.type !== TokenType.Operator) return false;
    const nextPrec = PRECEDENCE[tok.value];
    if (nextPrec === undefined || nextPrec <= currentPrecedence) return false;
    this.advance();
    return true;
  }

  private consumeKeyword(value: string): void {
    const tok = this.peek();
    if (tok.type === TokenType.Keyword && tok.value === value) {
      this.advance();
      return;
    }
    this.error(tok, `Expected keyword '${value}'`);
  }

  private consumeIdentifier(message: string): Identifier {
    const tok = this.peek();
    if (tok.type === TokenType.Identifier) {
      this.advance();
      return { type: "Identifier", name: tok.value };
    }
    this.error(tok, message);
  }

  private consumeDelimiter(value: string, message: string): void {
    const tok = this.peek();
    if (tok.type === TokenType.Delimiter && tok.value === value) {
      this.advance();
      return;
    }
    this.error(tok, message);
  }

  private consumeOperator(value: string, message: string): void {
    const tok = this.peek();
    if (tok.type === TokenType.Operator && tok.value === value) {
      this.advance();
      return;
    }
    this.error(tok, message);
  }

  private matchDelimiter(value: string): boolean {
    const tok = this.peek();
    if (tok.type === TokenType.Delimiter && tok.value === value) {
      this.advance();
      return true;
    }
    return false;
  }

  private checkDelimiter(value: string): boolean {
    const tok = this.peek();
    return tok.type === TokenType.Delimiter && tok.value === value;
  }

  private advance(): Token {
    if (!this.isAtEnd()) this.current++;
    return this.previous();
  }

  private peek(): Token {
    return this.tokens[this.current];
  }

  private peekNext(): Token | undefined {
    return this.tokens[this.current + 1];
  }

  private previous(): Token {
    return this.tokens[this.current - 1];
  }

  private isAtEnd(): boolean {
    return this.peek().type === TokenType.EOF;
  }

  private error(token: Token, message: string): never {
    throw new SyntaxError(`${message} at position ${token.position}`);
  }
}
