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

const KEYWORDS = new Set([
  "fn",
  "if",
  "else",
  "for",
  "in",
  "import",
  "return",
  "print",
]);

const SINGLE_CHAR_OPERATORS = new Set([
  "+",
  "-",
  "*",
  "/",
  "=",
  "<",
  ">",
  "!",
  ".",
  ",",
  "{",
  "}",
  "(",
  ")",
]);

const DELIMITERS = new Set(["{", "}", "(", ")", ","]);

const TWO_CHAR_OPERATORS = new Set(["==", "!=", "<=", ">=", ".."]);

export class Lexer {
  private src: string;
  private pos = 0;

  constructor(source: string) {
    this.src = source;
  }

  tokenize(): Token[] {
    const tokens: Token[] = [];

    while (!this.isAtEnd()) {
      this.skipWhitespace();
      if (this.isAtEnd()) break;

      const char = this.peek();
      const position = this.pos;

      if (this.isAlpha(char) || char === "_") {
        tokens.push(this.readIdentifier(position));
        continue;
      }

      if (this.isDigit(char)) {
        tokens.push(this.readNumber(position));
        continue;
      }

      if (char === '"' || char === "'") {
        tokens.push(this.readString(position));
        continue;
      }

      const opToken = this.readOperatorOrDelimiter(position);
      if (opToken) {
        tokens.push(opToken);
        continue;
      }

      throw new SyntaxError(`Unexpected character '${char}' at position ${position}`);
    }

    tokens.push({ type: TokenType.EOF, value: "", position: this.pos });
    return tokens;
  }

  private readIdentifier(start: number): Token {
    let value = "";
    while (!this.isAtEnd() && (this.isAlphaNumeric(this.peek()) || this.peek() === "_")) {
      value += this.advance();
    }

    const type = KEYWORDS.has(value) ? TokenType.Keyword : TokenType.Identifier;
    return { type, value, position: start };
  }

  private readNumber(start: number): Token {
    let value = "";
    while (!this.isAtEnd() && this.isDigit(this.peek())) {
      value += this.advance();
    }

    if (!this.isAtEnd() && this.peek() === "." && this.isDigit(this.peekNext())) {
      value += this.advance();
      while (!this.isAtEnd() && this.isDigit(this.peek())) {
        value += this.advance();
      }
    }

    return { type: TokenType.Number, value, position: start };
  }

  private readString(start: number): Token {
    const quote = this.advance();
    let value = "";

    while (!this.isAtEnd() && this.peek() !== quote) {
      const ch = this.advance();
      value += ch;
    }

    if (this.isAtEnd()) {
      throw new SyntaxError(`Unterminated string starting at position ${start}`);
    }

    this.advance(); // closing quote
    return { type: TokenType.String, value, position: start };
  }

  private readOperatorOrDelimiter(start: number): Token | null {
    const first = this.advance();
    const potentialTwo = first + this.peek();

    if (TWO_CHAR_OPERATORS.has(potentialTwo)) {
      this.advance();
      return { type: TokenType.Operator, value: potentialTwo, position: start };
    }

    if (SINGLE_CHAR_OPERATORS.has(first)) {
      if (DELIMITERS.has(first)) {
        return { type: TokenType.Delimiter, value: first, position: start };
      }
      return { type: TokenType.Operator, value: first, position: start };
    }

    return null;
  }

  private skipWhitespace(): void {
    while (!this.isAtEnd()) {
      const ch = this.peek();
      if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
        this.advance();
      } else {
        break;
      }
    }
  }

  private isAlpha(ch: string): boolean {
    return /[a-zA-Z]/.test(ch);
  }

  private isDigit(ch: string): boolean {
    return /[0-9]/.test(ch);
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

  private advance(): string {
    return this.src[this.pos++] ?? "";
  }

  private isAtEnd(): boolean {
    return this.pos >= this.src.length;
  }
}
