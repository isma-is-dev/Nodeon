import { KEYWORDS } from "../../language/keywords.js";
import { OPERATORS, TWO_CHAR_OPERATORS, THREE_CHAR_OPERATORS, FOUR_CHAR_OPERATORS } from "../../language/operators.js";
import { DELIMITERS } from "../../language/symbols.js";
class Lexer {
  constructor(source) {
    this.src = source;
    this.pos = 0;
    this.line = 1;
    this.column = 1;
  }

  tokenize() {
    const tokens = [];
    while (!this.isAtEnd()) {
      this.skipWhitespaceAndComments();
      if (this.isAtEnd()) {
        break;
      }
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
      if (char === "\"" || char === "'") {
        tokens.push(this.readString(loc));
        continue;
      }
      if (char === "`") {
        tokens.push(this.readTemplateLiteral(loc));
        continue;
      }
      if (char === "#" && this.pos + 1 < this.src.length && (this.isAlpha(this.src[this.pos + 1]) || this.src[this.pos + 1] === "_")) {
        this.advance();
        const ident = this.readIdentifier(loc);
        tokens.push(this.makeToken("Identifier", "#" + ident.value, loc));
        continue;
      }
      if (char === "@" && this.pos + 1 < this.src.length && (this.isAlpha(this.src[this.pos + 1]) || this.src[this.pos + 1] === "_")) {
        this.advance();
        const ident = this.readIdentifier(loc);
        tokens.push(this.makeToken("Decorator", "@" + ident.value, loc));
        continue;
      }
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
      throw new Error(`Unexpected character '${char}' at ${this.line}:${this.column}`);
    }
    tokens.push(this.makeToken("EOF", "", this.loc()));
    return tokens;
  }

  loc() {
    return { line: this.line, column: this.column, offset: this.pos };
  }

  makeToken(type, value, loc) {
    return { type: type, value: value, position: loc.offset, loc: loc };
  }

  readIdentifier(loc) {
    let value = "";
    while (!this.isAtEnd() && (this.isAlphaNumeric(this.peek()) || this.peek() === "_" || this.peek() === "$")) {
      value = value + this.advance();
    }
    const type = KEYWORDS.has(value) ? "Keyword" : "Identifier";
    return this.makeToken(type, value, loc);
  }

  readNumber(loc) {
    let value = "";
    if (this.peek() === "0" && !this.isAtEnd()) {
      const next = this.peekNext();
      if (next === "x" || next === "X") {
        value = value + this.advance();
        value = value + this.advance();
        while (!this.isAtEnd() && this.isHexDigit(this.peek())) {
          value = value + this.advance();
        }
        return this.makeToken("Number", value, loc);
      }
      if (next === "b" || next === "B") {
        value = value + this.advance();
        value = value + this.advance();
        while (!this.isAtEnd() && (this.peek() === "0" || this.peek() === "1")) {
          value = value + this.advance();
        }
        return this.makeToken("Number", value, loc);
      }
      if (next === "o" || next === "O") {
        value = value + this.advance();
        value = value + this.advance();
        while (!this.isAtEnd() && this.peek() >= "0" && this.peek() <= "7") {
          value = value + this.advance();
        }
        return this.makeToken("Number", value, loc);
      }
    }
    while (!this.isAtEnd() && this.isDigit(this.peek())) {
      value = value + this.advance();
    }
    if (!this.isAtEnd() && this.peek() === "." && this.isDigit(this.peekNext())) {
      value = value + this.advance();
      while (!this.isAtEnd() && this.isDigit(this.peek())) {
        value = value + this.advance();
      }
    }
    if (!this.isAtEnd() && (this.peek() === "e" || this.peek() === "E")) {
      value = value + this.advance();
      if (!this.isAtEnd() && (this.peek() === "+" || this.peek() === "-")) {
        value = value + this.advance();
      }
      while (!this.isAtEnd() && this.isDigit(this.peek())) {
        value = value + this.advance();
      }
    }
    if (!this.isAtEnd() && this.peek() === "n") {
      value = value + this.advance();
    }
    return this.makeToken("Number", value, loc);
  }

  readString(loc) {
    const quote = this.advance();
    let value = "";
    while (!this.isAtEnd() && this.peek() !== quote) {
      if (this.peek() === "\\") {
        this.advance();
        if (this.isAtEnd()) {
          break;
        }
        const esc = this.advance();
        switch (esc) {
          case "n": {
            value = value + "\n";
            break;
          }
          case "t": {
            value = value + "\t";
            break;
          }
          case "r": {
            value = value + "\r";
            break;
          }
          case "\\": {
            value = value + "\\";
            break;
          }
          case "'": {
            value = value + "'";
            break;
          }
          case "\"": {
            value = value + "\"";
            break;
          }
          case "0": {
            value = value + "\u0000";
            break;
          }
          case "x": {
            value = value + this.readHexEscape();
            break;
          }
          case "u": {
            value = value + this.readUnicodeEscape();
            break;
          }
          default: {
            value = value + "\\" + esc;
            break;
          }
        }
        continue;
      }
      value = value + this.advance();
    }
    if (this.isAtEnd()) {
      throw new SyntaxError(`Unterminated string literal at ${loc.line}:${loc.column}`);
    }
    this.advance();
    const tokenType = quote === "'" ? "RawString" : "String";
    return this.makeToken(tokenType, value, loc);
  }

  readTemplateLiteral(loc) {
    this.advance();
    let value = "";
    while (!this.isAtEnd() && this.peek() !== "`") {
      if (this.peek() === "\\") {
        this.advance();
        if (this.isAtEnd()) {
          break;
        }
        const esc = this.advance();
        switch (esc) {
          case "n": {
            value = value + "\n";
            break;
          }
          case "t": {
            value = value + "\t";
            break;
          }
          case "r": {
            value = value + "\r";
            break;
          }
          case "\\": {
            value = value + "\\";
            break;
          }
          case "`": {
            value = value + "`";
            break;
          }
          case "$": {
            value = value + "$";
            break;
          }
          case "0": {
            value = value + "\u0000";
            break;
          }
          default: {
            value = value + "\\" + esc;
            break;
          }
        }
        continue;
      }
      if (this.peek() === "$" && this.peekNext() === "{") {
        value = value + this.advance();
        value = value + this.advance();
        let depth = 1;
        while (!this.isAtEnd() && depth > 0) {
          if (this.peek() === "{") {
            depth = depth + 1;
          }
          if (this.peek() === "}") {
            depth = depth - 1;
          }
          if (depth > 0) {
            value = value + this.advance();
          } else {
            this.advance();
          }
        }
        value = value + "}";
        continue;
      }
      value = value + this.advance();
    }
    if (this.isAtEnd()) {
      throw new SyntaxError(`Unterminated template literal at ${loc.line}:${loc.column}`);
    }
    this.advance();
    return this.makeToken("TemplateLiteral", value, loc);
  }

  readHexEscape() {
    let code = "";
    let i = 0;
    while (i < 2 && !this.isAtEnd() && this.isHexDigit(this.peek())) {
      code = code + this.advance();
      i = i + 1;
    }
    return String.fromCharCode(parseInt(code, 16));
  }

  readUnicodeEscape() {
    if (this.peek() === "{") {
      this.advance();
      let code = "";
      while (!this.isAtEnd() && this.peek() !== "}") {
        code = code + this.advance();
      }
      if (!this.isAtEnd()) {
        this.advance();
      }
      return String.fromCodePoint(parseInt(code, 16));
    }
    code = "";
    let i = 0;
    while (i < 4 && !this.isAtEnd()) {
      code = code + this.advance();
      i = i + 1;
    }
    return String.fromCharCode(parseInt(code, 16));
  }

  readOperatorOrDelimiter(loc) {
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
      return this.makeToken("Operator", potentialFour, loc);
    }
    if (THREE_CHAR_OPERATORS.has(potentialThree)) {
      this.advance();
      this.advance();
      this.advance();
      return this.makeToken("Operator", potentialThree, loc);
    }
    if (TWO_CHAR_OPERATORS.has(potentialTwo)) {
      this.advance();
      this.advance();
      return this.makeToken("Operator", potentialTwo, loc);
    }
    if (OPERATORS.has(first)) {
      this.advance();
      return this.makeToken("Operator", first, loc);
    }
    if (DELIMITERS.has(first)) {
      this.advance();
      return this.makeToken("Delimiter", first, loc);
    }
    return null;
  }

  skipWhitespaceAndComments() {
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
      if (ch === "/" && this.peekNext() === "/") {
        this.skipLineComment();
        continue;
      }
      if (ch === "/" && this.peekNext() === "*") {
        this.skipBlockComment();
        continue;
      }
      break;
    }
  }

  skipLineComment() {
    while (!this.isAtEnd() && this.peek() !== "\n") {
      this.advance();
    }
  }

  skipBlockComment() {
    const loc = this.loc();
    this.advance();
    this.advance();
    while (!this.isAtEnd()) {
      if (this.peek() === "*" && this.peekNext() === "/") {
        this.advance();
        this.advance();
        return;
      }
      this.advance();
    }
    throw new SyntaxError(`Unterminated block comment at ${loc.line}:${loc.column}`);
  }

  isAlpha(ch) {
    return ch >= "a" && ch <= "z" || ch >= "A" && ch <= "Z";
  }

  isDigit(ch) {
    return ch >= "0" && ch <= "9";
  }

  isHexDigit(ch) {
    return this.isDigit(ch) || ch >= "a" && ch <= "f" || ch >= "A" && ch <= "F";
  }

  isAlphaNumeric(ch) {
    return this.isAlpha(ch) || this.isDigit(ch);
  }

  peek() {
    return this.src[this.pos] ?? "";
  }

  peekNext() {
    return this.src[this.pos + 1] ?? "";
  }

  peekAt(offset) {
    return this.src[this.pos + offset] ?? "";
  }

  advance() {
    const ch = this.src[this.pos] ?? "";
    this.pos = this.pos + 1;
    if (ch === "\n") {
      this.line = this.line + 1;
      this.column = 1;
    } else {
      this.column = this.column + 1;
    }
    return ch;
  }

  isAtEnd() {
    return this.pos >= this.src.length;
  }

  isRegexStart(tokens) {
    if (tokens.length === 0) {
      return true;
    }
    const prev = tokens[tokens.length - 1];
    if (prev.type === "Identifier") {
      return false;
    }
    if (prev.type === "Number") {
      return false;
    }
    if (prev.type === "String" || prev.type === "RawString") {
      return false;
    }
    if (prev.type === "TemplateLiteral") {
      return false;
    }
    if (prev.type === "RegExp") {
      return false;
    }
    if (prev.type === "Delimiter" && (prev.value === ")" || prev.value === "]")) {
      return false;
    }
    if (prev.type === "Operator" && (prev.value === "++" || prev.value === "--")) {
      return false;
    }
    if (prev.type === "Keyword" && (prev.value === "this" || prev.value === "super" || prev.value === "true" || prev.value === "false" || prev.value === "null" || prev.value === "undefined")) {
      return false;
    }
    return true;
  }

  readRegExp(loc) {
    this.advance();
    let pattern = "";
    let inCharClass = false;
    while (!this.isAtEnd()) {
      const ch = this.peek();
      if (ch === "\\" && !this.isAtEnd()) {
        pattern = pattern + this.advance();
        if (!this.isAtEnd()) {
          pattern = pattern + this.advance();
        }
        continue;
      }
      if (ch === "[") {
        inCharClass = true;
      }
      if (ch === "]") {
        inCharClass = false;
      }
      if (ch === "/" && !inCharClass) {
        break;
      }
      if (ch === "\n") {
        throw new SyntaxError(`Unterminated regex literal at ${loc.line}:${loc.column}`);
      }
      pattern = pattern + this.advance();
    }
    if (this.isAtEnd()) {
      throw new SyntaxError(`Unterminated regex literal at ${loc.line}:${loc.column}`);
    }
    this.advance();
    let flags = "";
    while (!this.isAtEnd() && this.isRegexFlag(this.peek())) {
      flags = flags + this.advance();
    }
    const value = flags ? `/${pattern}/${flags}` : `/${pattern}/`;
    return this.makeToken("RegExp", value, loc);
  }

  isRegexFlag(ch) {
    return ch === "g" || ch === "i" || ch === "m" || ch === "s" || ch === "u" || ch === "y" || ch === "d" || ch === "n";
  }
}
export { Lexer };