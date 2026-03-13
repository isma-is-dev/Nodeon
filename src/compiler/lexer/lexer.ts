import { Token, TokenType, SourceLocation } from "@language/tokens";
import { KEYWORDS } from "@language/keywords";
import { OPERATORS, TWO_CHAR_OPERATORS, THREE_CHAR_OPERATORS, FOUR_CHAR_OPERATORS } from "@language/operators";
import { DELIMITERS } from "@language/symbols";

export class Lexer {
  private src: string;
  private pos = 0;
  private line = 1;
  private column = 1;

  constructor(source: string) {
    this.src = source;
  }

  tokenize(): Token[] {
    const tokens: Token[] = [];

    while (!this.isAtEnd()) {
      this.skipWhitespaceAndComments();
      if (this.isAtEnd()) break;

      const char = this.peek();
      const loc = this.loc();

      if (char === "$" || this.isAlpha(char) || char === "_") {
        tokens.push(this.readIdentifier(loc));
        continue;
      }

      if (this.isDigit(char)) {
        tokens.push(this.readNumber(loc));
        continue;
      }

      if (char === '"' || char === "'") {
        tokens.push(this.readString(loc));
        continue;
      }

      if (char === "`") {
        tokens.push(this.readTemplateLiteral(loc));
        continue;
      }

      // Private field: #identifier
      if (char === "#" && this.pos + 1 < this.src.length && (this.isAlpha(this.src[this.pos + 1]) || this.src[this.pos + 1] === "_")) {
        this.advance(); // skip #
        const ident = this.readIdentifier(loc);
        tokens.push(this.makeToken(TokenType.Identifier, "#" + ident.value, loc));
        continue;
      }

      // Regex literal: /pattern/flags
      // Must distinguish from division operator based on context
      // Also check lookahead: regex patterns never start with space/*/=
      if (char === "/" && this.isRegexStart(tokens)) {
        const nextCh = this.pos + 1 < this.src.length ? this.src[this.pos + 1] : "";
        if (nextCh !== " " && nextCh !== "\t" && nextCh !== "=" && nextCh !== "*") {
          tokens.push(this.readRegExp(loc));
          continue;
        }
      }

      const opToken = this.readOperatorOrDelimiter(loc);
      if (opToken) {
        tokens.push(opToken);
        continue;
      }

      this.error(`Unexpected character '${char}'`);
    }

    tokens.push(this.makeToken(TokenType.EOF, "", this.loc()));
    return tokens;
  }

  private loc(): SourceLocation {
    return { line: this.line, column: this.column, offset: this.pos };
  }

  private makeToken(type: TokenType, value: string, loc: SourceLocation): Token {
    return { type, value, position: loc.offset, loc };
  }

  private readIdentifier(loc: SourceLocation): Token {
    let value = "";
    while (!this.isAtEnd() && (this.isAlphaNumeric(this.peek()) || this.peek() === "_" || this.peek() === "$")) {
      value += this.advance();
    }

    const type = KEYWORDS.has(value) ? TokenType.Keyword : TokenType.Identifier;
    return this.makeToken(type, value, loc);
  }

  private readNumber(loc: SourceLocation): Token {
    let value = "";

    // Hex: 0x, Binary: 0b, Octal: 0o
    if (this.peek() === "0" && !this.isAtEnd()) {
      const next = this.peekNext();
      if (next === "x" || next === "X") {
        value += this.advance(); // 0
        value += this.advance(); // x
        while (!this.isAtEnd() && this.isHexDigit(this.peek())) {
          value += this.advance();
        }
        return this.makeToken(TokenType.Number, value, loc);
      }
      if (next === "b" || next === "B") {
        value += this.advance(); // 0
        value += this.advance(); // b
        while (!this.isAtEnd() && (this.peek() === "0" || this.peek() === "1")) {
          value += this.advance();
        }
        return this.makeToken(TokenType.Number, value, loc);
      }
      if (next === "o" || next === "O") {
        value += this.advance(); // 0
        value += this.advance(); // o
        while (!this.isAtEnd() && this.peek() >= "0" && this.peek() <= "7") {
          value += this.advance();
        }
        return this.makeToken(TokenType.Number, value, loc);
      }
    }

    while (!this.isAtEnd() && this.isDigit(this.peek())) {
      value += this.advance();
    }

    // Decimal part
    if (!this.isAtEnd() && this.peek() === "." && this.isDigit(this.peekNext())) {
      value += this.advance(); // .
      while (!this.isAtEnd() && this.isDigit(this.peek())) {
        value += this.advance();
      }
    }

    // Exponent: 1e10, 1.5E-3
    if (!this.isAtEnd() && (this.peek() === "e" || this.peek() === "E")) {
      value += this.advance();
      if (!this.isAtEnd() && (this.peek() === "+" || this.peek() === "-")) {
        value += this.advance();
      }
      while (!this.isAtEnd() && this.isDigit(this.peek())) {
        value += this.advance();
      }
    }

    // BigInt suffix: 123n
    if (!this.isAtEnd() && this.peek() === "n") {
      value += this.advance();
    }

    return this.makeToken(TokenType.Number, value, loc);
  }

  private readString(loc: SourceLocation): Token {
    const quote = this.advance();
    let value = "";

    while (!this.isAtEnd() && this.peek() !== quote) {
      if (this.peek() === "\\") {
        this.advance(); // skip backslash
        if (this.isAtEnd()) break;
        const esc = this.advance();
        switch (esc) {
          case "n": value += "\n"; break;
          case "t": value += "\t"; break;
          case "r": value += "\r"; break;
          case "\\": value += "\\"; break;
          case "'": value += "'"; break;
          case '"': value += '"'; break;
          case "0": value += "\0"; break;
          case "u": value += this.readUnicodeEscape(); break;
          default: value += "\\" + esc; break;
        }
        continue;
      }
      value += this.advance();
    }

    if (this.isAtEnd()) {
      this.errorAt(loc, "Unterminated string literal");
    }

    this.advance(); // closing quote

    // Single-quoted strings are raw (no interpolation), like Python
    // Double-quoted strings support Nodeon-style {interpolation}
    const tokenType = quote === "'" ? TokenType.RawString : TokenType.String;
    return this.makeToken(tokenType, value, loc);
  }

  private readTemplateLiteral(loc: SourceLocation): Token {
    this.advance(); // skip opening `
    let value = "";

    while (!this.isAtEnd() && this.peek() !== "`") {
      if (this.peek() === "\\") {
        this.advance();
        if (this.isAtEnd()) break;
        const esc = this.advance();
        switch (esc) {
          case "n": value += "\n"; break;
          case "t": value += "\t"; break;
          case "r": value += "\r"; break;
          case "\\": value += "\\"; break;
          case "`": value += "`"; break;
          case "$": value += "$"; break;
          case "0": value += "\0"; break;
          default: value += "\\" + esc; break;
        }
        continue;
      }

      // Pass through ${...} as-is for the parser to handle
      if (this.peek() === "$" && this.peekNext() === "{") {
        value += this.advance(); // $
        value += this.advance(); // {
        let depth = 1;
        while (!this.isAtEnd() && depth > 0) {
          if (this.peek() === "{") depth++;
          if (this.peek() === "}") depth--;
          if (depth > 0) value += this.advance();
          else this.advance(); // consume closing }
        }
        value += "}"; // add the closing } back for parser
        // Actually, let's keep the raw content between backticks
        continue;
      }

      value += this.advance();
    }

    if (this.isAtEnd()) {
      this.errorAt(loc, "Unterminated template literal");
    }

    this.advance(); // closing `
    return this.makeToken(TokenType.TemplateLiteral, value, loc);
  }

  private readUnicodeEscape(): string {
    if (this.peek() === "{") {
      this.advance(); // {
      let code = "";
      while (!this.isAtEnd() && this.peek() !== "}") {
        code += this.advance();
      }
      if (!this.isAtEnd()) this.advance(); // }
      return String.fromCodePoint(parseInt(code, 16));
    }
    let code = "";
    for (let i = 0; i < 4 && !this.isAtEnd(); i++) {
      code += this.advance();
    }
    return String.fromCharCode(parseInt(code, 16));
  }

  private readOperatorOrDelimiter(loc: SourceLocation): Token | null {
    const first = this.peek();
    const second = this.peekNext();
    const third = this.peekAt(2);
    const fourth = this.peekAt(3);

    const potentialFour = first + second + third + fourth;
    const potentialThree = first + second + third;
    const potentialTwo = first + second;

    if (FOUR_CHAR_OPERATORS.has(potentialFour)) {
      this.advance();
      this.advance();
      this.advance();
      this.advance();
      return this.makeToken(TokenType.Operator, potentialFour, loc);
    }

    if (THREE_CHAR_OPERATORS.has(potentialThree)) {
      this.advance();
      this.advance();
      this.advance();
      return this.makeToken(TokenType.Operator, potentialThree, loc);
    }

    if (TWO_CHAR_OPERATORS.has(potentialTwo)) {
      this.advance();
      this.advance();
      return this.makeToken(TokenType.Operator, potentialTwo, loc);
    }

    if (OPERATORS.has(first)) {
      this.advance();
      return this.makeToken(TokenType.Operator, first, loc);
    }

    if (DELIMITERS.has(first)) {
      this.advance();
      return this.makeToken(TokenType.Delimiter, first, loc);
    }

    return null;
  }

  private skipWhitespaceAndComments(): void {
    while (!this.isAtEnd()) {
      const ch = this.peek();

      if (ch === " " || ch === "\t" || ch === "\r") {
        this.advance();
        continue;
      }

      if (ch === "\n") {
        this.advance();
        continue;
      }

      // // line comment (JS style — also Nodeon's primary comment)
      if (ch === "/" && this.peekNext() === "/") {
        this.skipLineComment();
        continue;
      }

      // /* block comment */ (JS style)
      if (ch === "/" && this.peekNext() === "*") {
        this.skipBlockComment();
        continue;
      }

      break;
    }
  }

  private skipLineComment(): void {
    while (!this.isAtEnd() && this.peek() !== "\n") {
      this.advance();
    }
  }

  private skipBlockComment(): void {
    const loc = this.loc();
    this.advance(); // /
    this.advance(); // *
    while (!this.isAtEnd()) {
      if (this.peek() === "*" && this.peekNext() === "/") {
        this.advance(); // *
        this.advance(); // /
        return;
      }
      this.advance();
    }
    this.errorAt(loc, "Unterminated block comment");
  }

  private isAlpha(ch: string): boolean {
    return (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z");
  }

  private isDigit(ch: string): boolean {
    return ch >= "0" && ch <= "9";
  }

  private isHexDigit(ch: string): boolean {
    return this.isDigit(ch) || (ch >= "a" && ch <= "f") || (ch >= "A" && ch <= "F");
  }

  private isAlphaNumeric(ch: string): boolean {
    return this.isAlpha(ch) || this.isDigit(ch);
  }

  private peek(): string {
    return this.src[this.pos] ?? "";
  }

  private peekNext(): string {
    return this.src[this.pos + 1] ?? "";
  }

  private peekAt(offset: number): string {
    return this.src[this.pos + offset] ?? "";
  }

  private advance(): string {
    const ch = this.src[this.pos] ?? "";
    this.pos++;
    if (ch === "\n") {
      this.line++;
      this.column = 1;
    } else {
      this.column++;
    }
    return ch;
  }

  private isAtEnd(): boolean {
    return this.pos >= this.src.length;
  }

  // ── Regex literal support ─────────────────────────────────

  /**
   * Determines if '/' should be treated as the start of a regex literal
   * based on the previous token. Division follows value-producing tokens;
   * regex follows everything else.
   */
  private isRegexStart(tokens: Token[]): boolean {
    if (tokens.length === 0) return true;
    const prev = tokens[tokens.length - 1];
    // After these tokens, '/' is division, not regex
    if (prev.type === TokenType.Identifier) return false;
    if (prev.type === TokenType.Number) return false;
    if (prev.type === TokenType.String || prev.type === TokenType.RawString) return false;
    if (prev.type === TokenType.TemplateLiteral) return false;
    if (prev.type === TokenType.RegExp) return false;
    if (prev.type === TokenType.Delimiter && (prev.value === ")" || prev.value === "]")) return false;
    if (prev.type === TokenType.Operator && (prev.value === "++" || prev.value === "--")) return false;
    // After keywords that produce values
    if (prev.type === TokenType.Keyword && (prev.value === "this" || prev.value === "super" || prev.value === "true" || prev.value === "false" || prev.value === "null" || prev.value === "undefined")) return false;
    return true;
  }

  private readRegExp(loc: SourceLocation): Token {
    this.advance(); // skip opening /
    let pattern = "";
    let inCharClass = false;

    while (!this.isAtEnd()) {
      const ch = this.peek();
      if (ch === "\\" && !this.isAtEnd()) {
        pattern += this.advance(); // backslash
        if (!this.isAtEnd()) pattern += this.advance(); // escaped char
        continue;
      }
      if (ch === "[") inCharClass = true;
      if (ch === "]") inCharClass = false;
      if (ch === "/" && !inCharClass) break;
      if (ch === "\n") {
        this.errorAt(loc, "Unterminated regex literal");
      }
      pattern += this.advance();
    }

    if (this.isAtEnd()) {
      this.errorAt(loc, "Unterminated regex literal");
    }
    this.advance(); // skip closing /

    // Read flags: g, i, m, s, u, y, d
    let flags = "";
    while (!this.isAtEnd() && /[gimsuydn]/.test(this.peek())) {
      flags += this.advance();
    }

    const value = flags ? `/${pattern}/${flags}` : `/${pattern}/`;
    return this.makeToken(TokenType.RegExp, value, loc);
  }

  private error(message: string): never {
    throw new SyntaxError(`${message} at ${this.line}:${this.column}`);
  }

  private errorAt(loc: SourceLocation, message: string): never {
    throw new SyntaxError(`${message} at ${loc.line}:${loc.column}`);
  }
}
