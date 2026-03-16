import { NodeonError, ErrorCode } from "../errors.js";
const CONTEXTUAL_KW = ["print", "from", "async", "of", "get", "set", "static", "default", "as", "type", "enum", "interface", "implements"];
export class ParserBase {
  constructor(tokens, source) {
    this.tokens = tokens;
    this.current = 0;
    this.source = source ?? null;
    this.sourceLines = source ? source.split("\n") : [];
  }

  advance() {
    if (!this.isAtEnd()) {
      this.current = this.current + 1;
    }
    return this.previous();
  }

  peek() {
    return this.tokens[this.current];
  }

  peekNext() {
    return this.tokens[this.current + 1];
  }

  peekAt(offset) {
    return this.tokens[this.current + offset];
  }

  previous() {
    return this.tokens[this.current - 1];
  }

  isAtEnd() {
    return this.peek().type === "EOF";
  }

  checkKeyword(value) {
    const tok = this.peek();
    return tok.type === "Keyword" && tok.value === value;
  }

  checkContextualKeyword(value) {
    const tok = this.peek();
    return tok.type === "Identifier" && tok.value === value;
  }

  consumeContextualKeyword(value) {
    const tok = this.peek();
    if (tok.type === "Identifier" && tok.value === value) {
      this.advance();
      return;
    }
    this.error(tok, `Expected '${value}'`);
  }

  checkOperator(value) {
    const tok = this.peek();
    return tok.type === "Operator" && tok.value === value;
  }

  checkDelimiter(value) {
    const tok = this.peek();
    return tok.type === "Delimiter" && tok.value === value;
  }

  consumeKeyword(value) {
    const tok = this.peek();
    if (tok.type === "Keyword" && tok.value === value) {
      this.advance();
      return;
    }
    this.error(tok, `Expected keyword '${value}'`);
  }

  consumeIdentifier(message) {
    const tok = this.peek();
    if (tok.type === "Identifier") {
      this.advance();
      return { type: "Identifier", name: tok.value };
    }
    if (tok.type === "Keyword" && CONTEXTUAL_KW.includes(tok.value)) {
      this.advance();
      return { type: "Identifier", name: tok.value };
    }
    this.error(tok, message);
  }

  consumePropertyName(message) {
    const tok = this.peek();
    if (tok.type === "Identifier" || tok.type === "Keyword") {
      this.advance();
      return { type: "Identifier", name: tok.value };
    }
    this.error(tok, message);
  }

  consumeDelimiter(value, message) {
    const tok = this.peek();
    if (tok.type === "Delimiter" && tok.value === value) {
      this.advance();
      return;
    }
    this.error(tok, message);
  }

  consumeOperator(value, message) {
    const tok = this.peek();
    if (tok.type === "Operator" && tok.value === value) {
      this.advance();
      return;
    }
    this.error(tok, message);
  }

  matchDelimiter(value) {
    const tok = this.peek();
    if (tok.type === "Delimiter" && tok.value === value) {
      this.advance();
      return true;
    }
    return false;
  }

  isIdentifierLike(tok) {
    if (tok.type === "Identifier") {
      return true;
    }
    if (tok.type === "Keyword" && CONTEXTUAL_KW.includes(tok.value)) {
      return true;
    }
    return false;
  }

  error(token, message, code) {
    const loc = token.loc;
    let errCode = code ?? null;
    if (!errCode) {
      if (message.startsWith("Expected '") || message.startsWith("Expected \"")) {
        errCode = ErrorCode.E0101;
      } else if (message.includes("Expected expression")) {
        errCode = ErrorCode.E0105;
      } else if (message.includes("Expected") && message.includes("name")) {
        errCode = ErrorCode.E0107;
      } else if (message.includes(`Expected '{'`)) {
        errCode = ErrorCode.E0108;
      } else {
        errCode = ErrorCode.E0100;
      }
    }
    if (loc) {
      const sourceLine = this.sourceLines[loc.line - 1] ?? null;
      throw new NodeonError(errCode, message, loc.line, loc.column, sourceLine);
    }
    throw new NodeonError(errCode, message, 0, 0, null);
  }
}