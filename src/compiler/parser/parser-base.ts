import { Token, TokenType } from "@language/tokens";
import { Identifier } from "@ast/nodes";

/**
 * Base class for the Parser — handles token navigation and consumption.
 * Subclassed by Parser which adds all statement/expression parsing.
 */
export class ParserBase {
  protected tokens: Token[] = [];
  protected current = 0;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  // ── Token Navigation ──────────────────────────────────────────

  protected advance(): Token {
    if (!this.isAtEnd()) this.current++;
    return this.previous();
  }

  protected peek(): Token {
    return this.tokens[this.current];
  }

  protected peekNext(): Token | undefined {
    return this.tokens[this.current + 1];
  }

  protected peekAt(offset: number): Token | undefined {
    return this.tokens[this.current + offset];
  }

  protected previous(): Token {
    return this.tokens[this.current - 1];
  }

  protected isAtEnd(): boolean {
    return this.peek().type === TokenType.EOF;
  }

  // ── Token Checks ──────────────────────────────────────────────

  protected checkKeyword(value: string): boolean {
    const tok = this.peek();
    return tok.type === TokenType.Keyword && tok.value === value;
  }

  protected checkOperator(value: string): boolean {
    const tok = this.peek();
    return tok.type === TokenType.Operator && tok.value === value;
  }

  protected checkDelimiter(value: string): boolean {
    const tok = this.peek();
    return tok.type === TokenType.Delimiter && tok.value === value;
  }

  // ── Token Consumption ─────────────────────────────────────────

  protected consumeKeyword(value: string): void {
    const tok = this.peek();
    if (tok.type === TokenType.Keyword && tok.value === value) {
      this.advance();
      return;
    }
    this.error(tok, `Expected keyword '${value}'`);
  }

  protected consumeIdentifier(message: string): Identifier {
    const tok = this.peek();
    if (tok.type === TokenType.Identifier) {
      this.advance();
      return { type: "Identifier", name: tok.value };
    }
    // Allow some keywords to be used as identifiers in certain contexts
    if (tok.type === TokenType.Keyword && ["print", "from", "async", "of", "get", "set"].includes(tok.value)) {
      this.advance();
      return { type: "Identifier", name: tok.value };
    }
    this.error(tok, message);
  }

  protected consumeDelimiter(value: string, message: string): void {
    const tok = this.peek();
    if (tok.type === TokenType.Delimiter && tok.value === value) {
      this.advance();
      return;
    }
    this.error(tok, message);
  }

  protected consumeOperator(value: string, message: string): void {
    const tok = this.peek();
    if (tok.type === TokenType.Operator && tok.value === value) {
      this.advance();
      return;
    }
    this.error(tok, message);
  }

  protected matchDelimiter(value: string): boolean {
    const tok = this.peek();
    if (tok.type === TokenType.Delimiter && tok.value === value) {
      this.advance();
      return true;
    }
    return false;
  }

  // ── Error Reporting ───────────────────────────────────────────

  protected error(token: Token, message: string): never {
    const loc = token.loc;
    if (loc) {
      throw new SyntaxError(`${message} at ${loc.line}:${loc.column}`);
    }
    throw new SyntaxError(`${message} at position ${token.position}`);
  }
}
