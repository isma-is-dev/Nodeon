var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// dist/language/keywords.js
var KEYWORDS;
var init_keywords = __esm({
  "dist/language/keywords.js"() {
    KEYWORDS = /* @__PURE__ */ new Set(["fn", "if", "else", "for", "in", "of", "import", "from", "export", "return", "print", "class", "static", "extends", "new", "while", "do", "try", "catch", "finally", "throw", "async", "await", "const", "let", "var", "switch", "case", "default", "break", "continue", "typeof", "instanceof", "void", "delete", "yield", "this", "super", "true", "false", "null", "undefined", "debugger", "match", "enum", "interface", "go", "type", "as", "implements"]);
  }
});

// dist/language/operators.js
var OPERATORS, TWO_CHAR_OPERATORS, THREE_CHAR_OPERATORS, FOUR_CHAR_OPERATORS;
var init_operators = __esm({
  "dist/language/operators.js"() {
    OPERATORS = /* @__PURE__ */ new Set(["+", "-", "*", "/", "=", "<", ">", "!", ".", "%", "&", "|", "~", "^", "?"]);
    TWO_CHAR_OPERATORS = /* @__PURE__ */ new Set(["==", "!=", "<=", ">=", "..", "=>", "&&", "||", "??", "+=", "-=", "*=", "/=", "%=", "++", "--", "**", "?.", "<<", ">>", "|>", "&=", "|=", "^="]);
    THREE_CHAR_OPERATORS = /* @__PURE__ */ new Set(["...", "===", "!==", "**=", "&&=", "||=", "??=", ">>>", "<<=", ">>="]);
    FOUR_CHAR_OPERATORS = /* @__PURE__ */ new Set([">>>="]);
  }
});

// dist/language/symbols.js
var DELIMITERS;
var init_symbols = __esm({
  "dist/language/symbols.js"() {
    DELIMITERS = /* @__PURE__ */ new Set(["{", "}", "(", ")", ",", "[", "]", ":", ";"]);
  }
});

// dist/compiler/lexer/lexer.js
var Lexer;
var init_lexer = __esm({
  "dist/compiler/lexer/lexer.js"() {
    init_keywords();
    init_operators();
    init_symbols();
    Lexer = class {
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
          if (char === '"' || char === "'") {
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
            if (nextCh !== " " && nextCh !== "	" && nextCh !== "=" && nextCh !== "*") {
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
        return { type, value, position: loc.offset, loc };
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
                value = value + "	";
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
              case '"': {
                value = value + '"';
                break;
              }
              case "0": {
                value = value + "\0";
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
                value = value + "	";
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
                value = value + "\0";
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
        let code2 = "";
        let i = 0;
        while (i < 2 && !this.isAtEnd() && this.isHexDigit(this.peek())) {
          code2 = code2 + this.advance();
          i = i + 1;
        }
        return String.fromCharCode(parseInt(code2, 16));
      }
      readUnicodeEscape() {
        if (this.peek() === "{") {
          this.advance();
          let code2 = "";
          while (!this.isAtEnd() && this.peek() !== "}") {
            code2 = code2 + this.advance();
          }
          if (!this.isAtEnd()) {
            this.advance();
          }
          return String.fromCodePoint(parseInt(code2, 16));
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
          if (ch === " " || ch === "	" || ch === "\r") {
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
    };
  }
});

// dist/language/precedence.js
var PRECEDENCE, COMPOUND_ASSIGN;
var init_precedence = __esm({
  "dist/language/precedence.js"() {
    PRECEDENCE = { "|>": 1, "..": 1, "??": 2, "||": 3, "&&": 4, "|": 5, "^": 6, "&": 7, "==": 8, "!=": 8, "===": 8, "!==": 8, "<": 9, ">": 9, "<=": 9, ">=": 9, "instanceof": 9, "in": 9, "<<": 10, ">>": 10, ">>>": 10, "+": 11, "-": 11, "*": 12, "/": 12, "%": 12, "**": 13 };
    COMPOUND_ASSIGN = /* @__PURE__ */ new Set(["+=", "-=", "*=", "/=", "%=", "**=", "&&=", "||=", "??=", "<<=", ">>=", ">>>=", "&=", "|=", "^="]);
  }
});

// dist/compiler/errors.js
function findSuggestions(message) {
  for (const key in Object.keys(ERROR_SUGGESTIONS)) {
    if (message.includes(key)) {
      return ERROR_SUGGESTIONS[key];
    }
  }
  const kwMatch = message.match(/Expected keyword '(\w+)'/);
  if (kwMatch) {
    return ["The keyword '" + kwMatch[1] + "' was expected here."];
  }
  return [];
}
var ErrorCode, ERROR_SUGGESTIONS, NodeonError;
var init_errors = __esm({
  "dist/compiler/errors.js"() {
    ErrorCode = Object.freeze({ E0100: "E0100", E0101: "E0101", E0102: "E0102", E0103: "E0103", E0104: "E0104", E0105: "E0105", E0106: "E0106", E0107: "E0107", E0108: "E0108", E0109: "E0109", E0110: "E0110", E0200: "E0200", E0201: "E0201", E0202: "E0202", E0300: "E0300", E0301: "E0301", E0302: "E0302", E0400: "E0400", E0401: "E0401", E0402: "E0402" });
    ERROR_SUGGESTIONS = { "Expected ')'": ["You might have forgotten a closing parenthesis.", "Check that every '(' has a matching ')'."], "Expected '}'": ["You might have forgotten a closing brace.", `Check that every '{' has a matching '}'.`], "Expected ']'": ["You might have forgotten a closing bracket.", "Check that every '[' has a matching ']'."], [`Expected '{'`]: ["Block statements require opening braces.", "Nodeon uses { } for blocks, not indentation."], "Expected '('": ["Function calls and declarations require parentheses."], "Expected '=' in assignment": ["Variables must be initialized when declared.", "Example: x = 42  or  let x = 42"], "Expected '=' after destructuring pattern": ["Destructuring requires an initializer.", "Example: { a, b } = obj  or  [x, y] = arr"], "Expected function name": ["Functions declared with 'fn' must have a name.", "Example: fn myFunction() { ... }", "For anonymous functions, use arrow syntax: (x) => x * 2"], "Expected parameter name": ["Function parameters must be identifiers.", "Example: fn add(a, b) { a + b }"], "Expected expression": ["An expression was expected here (value, variable, function call, etc.).", "Check for missing operands or extra operators."], "Expected module source string": ["Import source must be a string literal.", `Example: import { foo } from 'my-module'`], "Expected 'as' after '*'": ["Namespace imports require 'as' keyword.", "Example: import * as utils from './utils'"], "Expected variable name": ["Variable names must be valid identifiers.", "Keywords like 'fn', 'if', 'for', 'class' cannot be used as variable names."] };
    NodeonError = class extends SyntaxError {
      constructor(code2, message, line, column, sourceLine) {
        super(message + " at " + line + ":" + column);
        this.name = "NodeonError";
        this.code = code2;
        this.line = line;
        this.column = column;
        this.sourceLine = sourceLine ?? null;
        this.help = findSuggestions(message);
      }
    };
  }
});

// dist/compiler/parser/parser-base.js
var CONTEXTUAL_KW, ParserBase;
var init_parser_base = __esm({
  "dist/compiler/parser/parser-base.js"() {
    init_errors();
    CONTEXTUAL_KW = ["print", "from", "async", "of", "get", "set", "static", "default", "as", "type", "enum", "interface", "implements"];
    ParserBase = class {
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
      error(token, message, code2) {
        const loc = token.loc;
        let errCode = code2 ?? null;
        if (!errCode) {
          if (message.startsWith("Expected '") || message.startsWith('Expected "')) {
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
    };
  }
});

// dist/compiler/parser/parser-types.js
var ParserTypes;
var init_parser_types = __esm({
  "dist/compiler/parser/parser-types.js"() {
    init_parser_base();
    ParserTypes = class extends ParserBase {
      constructor(tokens, source) {
        super(tokens, source);
      }
      parseTypeParams() {
        if (!this.checkOperator("<")) {
          return void 0;
        }
        const next = this.peekNext();
        if (!next || next.type !== "Identifier") {
          return void 0;
        }
        this.advance();
        const params = [];
        do {
          const param = this.consumeIdentifier("Expected type parameter name");
          params.push(param.name);
        } while (this.matchDelimiter(","));
        if (this.checkOperator(">")) {
          this.advance();
        }
        return params.length > 0 ? params : void 0;
      }
      parseTypeAnnotation() {
        let type = this.parseTypePrimary();
        while (this.checkDelimiter("[")) {
          const next = this.peekNext();
          if (next && next.type === "Delimiter" && next.value === "]") {
            this.advance();
            this.advance();
            type = { kind: "array", elementType: type };
          } else {
            break;
          }
        }
        if (this.checkOperator("?")) {
          this.advance();
          type = { kind: "nullable", inner: type };
        }
        if (this.checkOperator("|") && !this.checkOperator("||")) {
          const types = [type];
          while (this.checkOperator("|") && !this.checkOperator("||")) {
            this.advance();
            let next = this.parseTypePrimary();
            while (this.checkDelimiter("[")) {
              const n2 = this.peekNext();
              if (n2 && n2.type === "Delimiter" && n2.value === "]") {
                this.advance();
                this.advance();
                next = { kind: "array", elementType: next };
              } else {
                break;
              }
            }
            types.push(next);
          }
          type = { kind: "union", types };
        }
        if (this.checkOperator("&") && !this.checkOperator("&&")) {
          const types = [type];
          while (this.checkOperator("&") && !this.checkOperator("&&")) {
            this.advance();
            let next = this.parseTypePrimary();
            while (this.checkDelimiter("[")) {
              const n2 = this.peekNext();
              if (n2 && n2.type === "Delimiter" && n2.value === "]") {
                this.advance();
                this.advance();
                next = { kind: "array", elementType: next };
              } else {
                break;
              }
            }
            types.push(next);
          }
          type = { kind: "intersection", types };
        }
        return type;
      }
      parseTypePrimary() {
        const tok = this.peek();
        if (tok.type === "Delimiter" && tok.value === "(") {
          this.advance();
          const params = [];
          if (!this.checkDelimiter(")")) {
            do {
              params.push(this.parseTypeAnnotation());
            } while (this.matchDelimiter(","));
          }
          this.consumeDelimiter(")", "Expected ')' in function type");
          this.consumeOperator("=>", "Expected '=>' in function type");
          const returnType = this.parseTypeAnnotation();
          return { kind: "function", params, returnType };
        }
        if (tok.type === "Identifier" || tok.type === "Keyword" && ["void", "null", "undefined"].includes(tok.value)) {
          const name = tok.value;
          this.advance();
          if (this.checkOperator("<")) {
            this.advance();
            const args = [];
            if (!this.checkOperator(">")) {
              do {
                args.push(this.parseTypeAnnotation());
              } while (this.matchDelimiter(","));
            }
            this.consumeOperator(">", "Expected '>' after generic type arguments");
            return { kind: "generic", name, args };
          }
          return { kind: "named", name };
        }
        this.error(tok, "Expected type annotation");
      }
      parseObjectPattern() {
        this.consumeDelimiter("{", `Expected '{'`);
        const properties = [];
        let rest = void 0;
        while (!this.checkDelimiter("}") && !this.isAtEnd()) {
          if (this.checkOperator("...")) {
            this.advance();
            rest = this.consumeIdentifier("Expected rest identifier");
            break;
          }
          const key = this.consumeIdentifier("Expected property name");
          let value = key;
          let shorthand = true;
          let defaultValue = void 0;
          if (this.checkDelimiter(":")) {
            this.advance();
            shorthand = false;
            if (this.checkDelimiter("{")) {
              value = this.parseObjectPattern();
            } else if (this.checkDelimiter("[")) {
              value = this.parseArrayPattern();
            } else {
              value = this.consumeIdentifier("Expected alias name");
            }
          }
          if (this.checkOperator("=")) {
            this.advance();
            defaultValue = this.parseExpression();
          }
          properties.push({ type: "ObjectPatternProperty", key, value, shorthand, defaultValue });
          if (!this.matchDelimiter(",")) {
            break;
          }
        }
        this.consumeDelimiter("}", "Expected '}'");
        return { type: "ObjectPattern", properties, rest };
      }
      parseArrayPattern() {
        this.consumeDelimiter("[", "Expected '['");
        const elements = [];
        let rest = void 0;
        while (!this.checkDelimiter("]") && !this.isAtEnd()) {
          if (this.checkOperator("...")) {
            this.advance();
            rest = this.consumeIdentifier("Expected rest identifier");
            break;
          }
          if (this.checkDelimiter(",")) {
            elements.push(null);
            this.advance();
            continue;
          }
          if (this.checkDelimiter("{")) {
            elements.push(this.parseObjectPattern());
          } else if (this.checkDelimiter("[")) {
            elements.push(this.parseArrayPattern());
          } else {
            elements.push(this.consumeIdentifier("Expected element name"));
          }
          if (!this.matchDelimiter(",")) {
            break;
          }
        }
        this.consumeDelimiter("]", "Expected ']'");
        return { type: "ArrayPattern", elements, rest };
      }
    };
  }
});

// dist/compiler/parser/parser-expressions.js
var ParserExpressions;
var init_parser_expressions = __esm({
  "dist/compiler/parser/parser-expressions.js"() {
    init_precedence();
    init_parser_types();
    init_lexer();
    ParserExpressions = class _ParserExpressions extends ParserTypes {
      constructor(tokens, source) {
        super(tokens, source);
      }
      parseExpressionStatement() {
        const expression = this.parseExpression();
        return { type: "ExpressionStatement", expression };
      }
      parseExpression(precedence) {
        const prec = precedence ?? 0;
        let left = this.parseUnary();
        while (true) {
          const tok = this.peek();
          if (tok.type === "Operator" && COMPOUND_ASSIGN.has(tok.value) && prec === 0) {
            if (left.type === "Identifier" || left.type === "MemberExpression") {
              this.advance();
              const right = this.parseExpression(0);
              left = { type: "CompoundAssignmentExpression", operator: tok.value, left, right };
              continue;
            }
          }
          if (tok.type === "Operator" && tok.value === "=" && prec === 0) {
            if (left.type === "Identifier" || left.type === "MemberExpression") {
              this.advance();
              const right = this.parseExpression(0);
              left = { type: "AssignmentExpression", left, right };
              continue;
            }
          }
          if (tok.type === "Operator" && PRECEDENCE[tok.value] !== void 0) {
            const opPrec = PRECEDENCE[tok.value];
            if (opPrec <= prec) {
              break;
            }
            this.advance();
            const right = this.parseExpression(tok.value === "**" ? opPrec - 1 : opPrec);
            left = { type: "BinaryExpression", operator: tok.value, left, right };
            continue;
          }
          if (tok.type === "Keyword" && (tok.value === "instanceof" || tok.value === "in")) {
            const opPrec = PRECEDENCE[tok.value];
            if (opPrec <= prec) {
              break;
            }
            this.advance();
            const right = this.parseExpression(opPrec);
            left = { type: "BinaryExpression", operator: tok.value, left, right };
            continue;
          }
          if ((tok.type === "Identifier" || tok.type === "Keyword") && tok.value === "as") {
            this.advance();
            const typeAnnotation = this.parseTypeAnnotation();
            left = { type: "AsExpression", expression: left, typeAnnotation };
            continue;
          }
          if (tok.type === "Operator" && tok.value === "?" && prec === 0) {
            const next = this.peekNext();
            if (next && next.type === "Operator" && next.value === ".") {
              break;
            }
            this.advance();
            const consequent = this.parseExpression();
            this.consumeDelimiter(":", "Expected ':' in ternary");
            const alternate = this.parseExpression();
            left = { type: "TernaryExpression", condition: left, consequent, alternate };
            continue;
          }
          break;
        }
        return left;
      }
      parseUnary() {
        const tok = this.peek();
        if (tok.type === "Keyword" && tok.value === "await") {
          this.advance();
          return { type: "AwaitExpression", argument: this.parseUnary() };
        }
        if (tok.type === "Keyword" && tok.value === "typeof") {
          this.advance();
          return { type: "TypeofExpression", argument: this.parseUnary() };
        }
        if (tok.type === "Keyword" && tok.value === "void") {
          this.advance();
          return { type: "VoidExpression", argument: this.parseUnary() };
        }
        if (tok.type === "Keyword" && tok.value === "delete") {
          this.advance();
          return { type: "DeleteExpression", argument: this.parseUnary() };
        }
        if (tok.type === "Keyword" && tok.value === "yield") {
          this.advance();
          let delegate = false;
          if (this.checkOperator("*")) {
            this.advance();
            delegate = true;
          }
          if (this.isAtEnd() || this.checkDelimiter("}") || this.checkDelimiter(")")) {
            return { type: "YieldExpression", argument: null, delegate };
          }
          return { type: "YieldExpression", argument: this.parseExpression(), delegate };
        }
        if (tok.type === "Keyword" && tok.value === "new") {
          this.advance();
          let callee = this.consumeIdentifier("Expected constructor name");
          while (this.checkOperator(".")) {
            this.advance();
            const prop = this.consumePropertyName("Expected property name");
            callee = { type: "MemberExpression", object: callee, property: prop, computed: false, optional: false };
          }
          const args = [];
          if (this.checkDelimiter("(")) {
            this.advance();
            if (!this.checkDelimiter(")")) {
              do {
                args.push(this.parseExpression());
              } while (this.matchDelimiter(","));
            }
            this.consumeDelimiter(")", "Expected ')'");
          }
          const newExpr = { type: "NewExpression", callee, arguments: args };
          return this.parsePostfix(newExpr);
        }
        if (tok.type === "Operator" && tok.value === "...") {
          this.advance();
          return { type: "SpreadExpression", argument: this.parseUnary() };
        }
        if (tok.type === "Operator" && (tok.value === "++" || tok.value === "--")) {
          this.advance();
          return { type: "UpdateExpression", operator: tok.value, argument: this.parseUnary(), prefix: true };
        }
        if (tok.type === "Operator" && (tok.value === "!" || tok.value === "-" || tok.value === "~" || tok.value === "+")) {
          this.advance();
          return { type: "UnaryExpression", operator: tok.value, argument: this.parseUnary() };
        }
        return this.parsePostfix();
      }
      parsePostfix(initial) {
        let left = initial ?? this.parsePrimary();
        while (!this.isAtEnd()) {
          const tok = this.peek();
          if (tok.type === "Operator" && (tok.value === "++" || tok.value === "--")) {
            if (left.type === "Identifier" || left.type === "MemberExpression") {
              this.advance();
              left = { type: "UpdateExpression", operator: tok.value, argument: left, prefix: false };
              continue;
            }
          }
          if (tok.type === "Operator" && (tok.value === "." || tok.value === "?.")) {
            const optional = tok.value === "?.";
            this.advance();
            if (optional && this.checkDelimiter("(")) {
              left = this.parseCallArguments(left, true);
              continue;
            }
            if (optional && this.checkDelimiter("[")) {
              this.advance();
              const prop2 = this.parseExpression();
              this.consumeDelimiter("]", "Expected ']'");
              left = { type: "MemberExpression", object: left, property: prop2, computed: true, optional: true };
              continue;
            }
            const prop = this.consumePropertyName("Expected property name");
            left = { type: "MemberExpression", object: left, property: prop, computed: false, optional };
            if (this.checkDelimiter("(")) {
              left = this.parseCallArguments(left, false);
            }
            continue;
          }
          if (tok.type === "Delimiter" && tok.value === "[") {
            this.advance();
            const prop = this.parseExpression();
            this.consumeDelimiter("]", "Expected ']'");
            left = { type: "MemberExpression", object: left, property: prop, computed: true, optional: false };
            continue;
          }
          if (tok.type === "Delimiter" && tok.value === "(") {
            if (left.type === "Identifier" || left.type === "MemberExpression" || left.type === "CallExpression") {
              left = this.parseCallArguments(left, false);
              continue;
            }
          }
          break;
        }
        return left;
      }
      parsePrimary() {
        const token = this.peek();
        if (token.type === "Delimiter" && token.value === "(") {
          if (this.isArrowFunction()) {
            return this.parseArrowFunction(false);
          }
          this.advance();
          const expr = this.parseExpression();
          this.consumeDelimiter(")", "Expected ')'");
          return expr;
        }
        if (token.type === "Delimiter" && token.value === "[") {
          return this.parseArrayExpression();
        }
        if (token.type === "Delimiter" && token.value === "{") {
          return this.parseObjectExpression();
        }
        if (token.type === "Keyword" && (token.value === "true" || token.value === "false")) {
          this.advance();
          return { type: "Literal", value: token.value === "true", literalType: "boolean" };
        }
        if (token.type === "Keyword" && token.value === "null") {
          this.advance();
          return { type: "Literal", value: null, literalType: "null" };
        }
        if (token.type === "Keyword" && token.value === "undefined") {
          this.advance();
          return { type: "Literal", value: void 0, literalType: "undefined" };
        }
        if (token.type === "Keyword" && token.value === "this") {
          this.advance();
          return { type: "Identifier", name: "this" };
        }
        if (token.type === "Keyword" && token.value === "super") {
          this.advance();
          return { type: "Identifier", name: "super" };
        }
        if (token.type === "Keyword" && token.value === "if") {
          this.advance();
          const condition = this.parseExpression();
          const consequent = this.parseBlock();
          this.consumeKeyword("else");
          const alternate = this.parseBlock();
          return { type: "IfExpression", condition, consequent, alternate };
        }
        if (token.type === "Keyword" && token.value === "import" && this.peekNext()?.type === "Delimiter" && this.peekNext()?.value === "(") {
          this.advance();
          return this.parseCallArguments({ type: "Identifier", name: "import" }, false);
        }
        if (token.type === "Identifier" && token.value === "comptime") {
          this.advance();
          if (this.checkDelimiter(`{`)) {
            const body = this.parseBlock();
            return { type: "ComptimeExpression", expression: null, body };
          }
          const expression = this.parseExpression();
          return { type: "ComptimeExpression", expression, body: null };
        }
        if (this.isIdentifierLike(token)) {
          this.advance();
          return { type: "Identifier", name: token.value };
        }
        if (token.type === "Number") {
          this.advance();
          return { type: "Literal", value: Number(token.value), literalType: "number" };
        }
        if (token.type === "RawString") {
          this.advance();
          return { type: "Literal", value: token.value, literalType: "string" };
        }
        if (token.type === "String") {
          this.advance();
          return this.parseStringLiteral(token.value, token.loc);
        }
        if (token.type === "TemplateLiteral") {
          this.advance();
          return this.parseTemplateLiteral(token.value, token.loc);
        }
        if (token.type === "RegExp") {
          this.advance();
          const regexStr = token.value;
          const lastSlash = regexStr.lastIndexOf("/");
          const pattern = regexStr.slice(1, lastSlash);
          const flags = regexStr.slice(lastSlash + 1);
          return { type: "RegExpLiteral", pattern, flags };
        }
        this.error(token, "Expected expression");
      }
      parseCallArguments(callee, optional) {
        const opt = optional ?? false;
        this.consumeDelimiter("(", "Expected '('");
        const args = [];
        const namedArgs = [];
        if (!this.checkDelimiter(")")) {
          do {
            if (this.checkDelimiter(")")) {
              break;
            }
            if (this.isNamedArgument()) {
              const name = this.consumeIdentifier("Expected argument name");
              this.consumeDelimiter(":", "Expected ':'");
              const value = this.parseExpression();
              namedArgs.push({ type: "NamedArgument", name, value });
            } else {
              args.push(this.parseExpression());
            }
          } while (this.matchDelimiter(","));
        }
        this.consumeDelimiter(")", "Expected ')'");
        const call = { type: "CallExpression", callee, arguments: args, optional: opt };
        if (namedArgs.length > 0) {
          call.namedArgs = namedArgs;
        }
        return call;
      }
      isNamedArgument() {
        const cur = this.peek();
        const next = this.peekNext();
        if ((cur.type === "Identifier" || this.isIdentifierLike(cur)) && next && next.type === "Delimiter" && next.value === ":") {
          return true;
        }
        return false;
      }
      parseArrayExpression() {
        this.consumeDelimiter("[", "Expected '['");
        const elements = [];
        if (!this.checkDelimiter("]")) {
          do {
            if (this.checkDelimiter("]")) {
              break;
            }
            elements.push(this.parseExpression());
          } while (this.matchDelimiter(","));
        }
        this.consumeDelimiter("]", "Expected ']'");
        return { type: "ArrayExpression", elements };
      }
      parseObjectExpression() {
        this.consumeDelimiter("{", `Expected '{'`);
        const properties = [];
        if (!this.checkDelimiter("}")) {
          do {
            if (this.checkDelimiter("}")) {
              break;
            }
            const keyTok = this.peek();
            let key = null;
            let computed = false;
            if (keyTok.type === "Delimiter" && keyTok.value === "[") {
              computed = true;
              this.advance();
              key = this.parseExpression();
              this.consumeDelimiter("]", "Expected ']'");
            } else if (keyTok.type === "Identifier" || keyTok.type === "Keyword") {
              key = { type: "Identifier", name: keyTok.value };
              this.advance();
            } else if (keyTok.type === "String" || keyTok.type === "RawString") {
              key = { type: "Literal", value: keyTok.value, literalType: "string" };
              this.advance();
            } else if (keyTok.type === "Number") {
              key = { type: "Literal", value: Number(keyTok.value), literalType: "number" };
              this.advance();
            } else {
              this.error(keyTok, "Expected property key");
            }
            if (!computed && !this.checkDelimiter(":")) {
              properties.push({ type: "ObjectProperty", key, value: { type: "Identifier", name: key.name }, shorthand: true, computed: false });
            } else {
              if (this.checkDelimiter(":")) {
                this.advance();
              }
              const value = this.parseExpression();
              properties.push({ type: "ObjectProperty", key, value, shorthand: false, computed });
            }
          } while (this.matchDelimiter(","));
        }
        this.consumeDelimiter("}", "Expected '}'");
        return { type: "ObjectExpression", properties };
      }
      isArrowFunction() {
        const saved = this.current;
        try {
          this.advance();
          let depth = 1;
          while (depth > 0 && !this.isAtEnd()) {
            const t = this.advance();
            if (t.type === "Delimiter" && t.value === "(") {
              depth = depth + 1;
            }
            if (t.type === "Delimiter" && t.value === ")") {
              depth = depth - 1;
            }
          }
          const next = this.peek();
          return next.type === "Operator" && next.value === "=>";
        } catch (e) {
          return false;
        } finally {
          this.current = saved;
        }
      }
      parseArrowFunction(isAsync) {
        this.consumeDelimiter("(", "Expected '('");
        const params = this.parseParamList();
        this.consumeDelimiter(")", "Expected ')'");
        this.consumeOperator("=>", "Expected '=>'");
        if (this.checkDelimiter("{")) {
          const body = this.parseBlock();
          return { type: "ArrowFunction", params, body, async: isAsync };
        }
        const expr = this.parseExpression();
        return { type: "ArrowFunction", params, body: expr, async: isAsync };
      }
      parseStringLiteral(raw, loc) {
        if (!raw.includes("{")) {
          return { type: "Literal", value: raw, literalType: "string" };
        }
        const parts = [];
        let buffer = "";
        let i = 0;
        while (i < raw.length) {
          if (raw[i] === "\\") {
            if (i + 1 < raw.length && raw[i + 1] === "{") {
              buffer = buffer + "{";
              i = i + 2;
              continue;
            }
          }
          if (raw[i] === "{") {
            if (buffer) {
              parts.push({ kind: "Text", value: buffer });
              buffer = "";
            }
            let j = i + 1;
            let inner = "";
            let braceDepth = 1;
            while (j < raw.length && braceDepth > 0) {
              if (raw[j] === "{") {
                braceDepth = braceDepth + 1;
              } else if (raw[j] === "}") {
                braceDepth = braceDepth - 1;
                if (braceDepth === 0) {
                  break;
                }
              }
              inner = inner + raw[j];
              j = j + 1;
            }
            if (j >= raw.length) {
              const where = loc ? " at " + loc.line + ":" + loc.column + i : "";
              throw new SyntaxError("Unterminated interpolation in string literal" + where);
            }
            const innerTokens = new Lexer(inner).tokenize();
            const innerParser = new _ParserExpressions(innerTokens);
            const expr = innerParser.parseExpression();
            parts.push({ kind: "Expression", expression: expr });
            i = j + 1;
            continue;
          }
          buffer = buffer + raw[i];
          i = i + 1;
        }
        if (buffer) {
          parts.push({ kind: "Text", value: buffer });
        }
        return { type: "TemplateLiteral", parts };
      }
      parseTemplateLiteral(raw, loc) {
        const parts = [];
        let buffer = "";
        let i = 0;
        while (i < raw.length) {
          if (raw[i] === "$" && i + 1 < raw.length && raw[i + 1] === "{") {
            if (buffer) {
              parts.push({ kind: "Text", value: buffer });
              buffer = "";
            }
            i = i + 2;
            let inner = "";
            let braceDepth = 1;
            while (i < raw.length && braceDepth > 0) {
              if (raw[i] === "{") {
                braceDepth = braceDepth + 1;
              } else if (raw[i] === "}") {
                braceDepth = braceDepth - 1;
                if (braceDepth === 0) {
                  break;
                }
              }
              inner = inner + raw[i];
              i = i + 1;
            }
            if (braceDepth !== 0) {
              const where = loc ? " at " + loc.line + ":" + loc.column + i : "";
              throw new SyntaxError("Unterminated interpolation in template literal" + where);
            }
            i = i + 1;
            const innerTokens = new Lexer(inner).tokenize();
            const innerParser = new _ParserExpressions(innerTokens);
            const expr = innerParser.parseExpression();
            parts.push({ kind: "Expression", expression: expr });
            continue;
          }
          buffer = buffer + raw[i];
          i = i + 1;
        }
        if (buffer) {
          parts.push({ kind: "Text", value: buffer });
        }
        if (parts.length === 0) {
          parts.push({ kind: "Text", value: "" });
        }
        return { type: "TemplateLiteral", parts };
      }
    };
  }
});

// dist/compiler/parser/parser-statements.js
var ParserStatements;
var init_parser_statements = __esm({
  "dist/compiler/parser/parser-statements.js"() {
    init_parser_expressions();
    ParserStatements = class extends ParserExpressions {
      constructor(tokens, source) {
        super(tokens, source);
      }
      parseBlock() {
        this.consumeDelimiter("{", `Expected '{'`);
        const statements = [];
        while (!this.checkDelimiter("}") && !this.isAtEnd()) {
          statements.push(this.parseStatement());
        }
        this.consumeDelimiter("}", "Expected '}'");
        return statements;
      }
      parseAsync() {
        this.consumeKeyword("async");
        const tok = this.peek();
        if (tok.type === "Keyword" && tok.value === "fn") {
          const next = this.peekNext();
          return this.parseFunctionDeclaration(true, next?.type === "Operator" && next?.value === "*");
        }
        this.error(tok, "Expected 'fn' after 'async'");
      }
      parseFunctionDeclaration(isAsync, isGenerator) {
        const isGen = isGenerator ?? false;
        this.consumeKeyword("fn");
        if (isGen && this.checkOperator("*")) {
          this.advance();
        }
        const name = this.consumeIdentifier("Expected function name");
        const typeParams = this.parseTypeParams();
        this.consumeDelimiter("(", "Expected '('");
        const params = this.parseParamList();
        this.consumeDelimiter(")", "Expected ')'");
        let returnType = void 0;
        if (this.checkDelimiter(":")) {
          this.advance();
          returnType = this.parseTypeAnnotation();
        }
        if (this.checkOperator("=")) {
          this.advance();
          const expr = this.parseExpression();
          return { type: "FunctionDeclaration", name, params, body: [{ type: "ExpressionStatement", expression: expr }], async: isAsync, generator: isGen, returnType, typeParams };
        }
        const body = this.parseBlock();
        return { type: "FunctionDeclaration", name, params, body, async: isAsync, generator: isGen, returnType, typeParams };
      }
      parseParamList() {
        const params = [];
        if (this.checkDelimiter(")")) {
          return params;
        }
        do {
          if (this.checkDelimiter(")")) {
            break;
          }
          let rest = false;
          let dv = void 0;
          if (this.checkOperator("...")) {
            this.advance();
            rest = true;
          }
          if (this.checkDelimiter("{")) {
            const pattern = this.parseObjectPattern();
            if (this.checkOperator("=")) {
              this.advance();
              dv = this.parseExpression();
            }
            params.push({ type: "Param", name: "__destructured", pattern, defaultValue: dv, rest });
            continue;
          }
          if (this.checkDelimiter("[")) {
            const pattern = this.parseArrayPattern();
            if (this.checkOperator("=")) {
              this.advance();
              dv = this.parseExpression();
            }
            params.push({ type: "Param", name: "__destructured", pattern, defaultValue: dv, rest });
            continue;
          }
          const tok = this.peek();
          if (!this.isIdentifierLike(tok)) {
            this.error(tok, "Expected parameter name");
          }
          this.advance();
          let typeAnnotation = void 0;
          if (this.checkDelimiter(":")) {
            this.advance();
            typeAnnotation = this.parseTypeAnnotation();
          }
          if (this.checkOperator("=")) {
            this.advance();
            dv = this.parseExpression();
          }
          params.push({ type: "Param", name: tok.value, typeAnnotation, defaultValue: dv, rest });
        } while (this.matchDelimiter(","));
        return params;
      }
      parseIfStatement() {
        this.consumeKeyword("if");
        const condition = this.parseExpression();
        const consequent = this.parseBlock();
        let alternate = null;
        if (this.checkKeyword("else")) {
          this.advance();
          if (this.checkKeyword("if")) {
            alternate = [this.parseIfStatement()];
          } else {
            alternate = this.parseBlock();
          }
        }
        return { type: "IfStatement", condition, consequent, alternate };
      }
      parseForStatement() {
        this.consumeKeyword("for");
        let variable = null;
        if (this.checkDelimiter("{")) {
          variable = this.parseObjectPattern();
        } else if (this.checkDelimiter("[")) {
          variable = this.parseArrayPattern();
        } else {
          variable = this.consumeIdentifier("Expected loop variable");
        }
        let kind = "in";
        if (this.checkKeyword("of")) {
          kind = "of";
          this.advance();
        } else {
          this.consumeKeyword("in");
        }
        const iterable = this.parseExpression();
        const body = this.parseBlock();
        return { type: "ForStatement", variable, iterable, body, kind };
      }
      parseWhileStatement() {
        this.consumeKeyword("while");
        const condition = this.parseExpression();
        const body = this.parseBlock();
        return { type: "WhileStatement", condition, body };
      }
      parseDoWhileStatement() {
        this.consumeKeyword("do");
        const body = this.parseBlock();
        this.consumeKeyword("while");
        const condition = this.parseExpression();
        return { type: "DoWhileStatement", condition, body };
      }
      parseReturnStatement() {
        this.consumeKeyword("return");
        if (this.isAtEnd() || this.checkDelimiter("}")) {
          return { type: "ReturnStatement", value: null };
        }
        const value = this.parseExpression();
        return { type: "ReturnStatement", value };
      }
      parseImportDeclaration() {
        this.consumeKeyword("import");
        let defaultImport = null;
        const namedImports = [];
        if (this.checkDelimiter("{")) {
          this.advance();
          if (!this.checkDelimiter("}")) {
            do {
              const tok = this.peek();
              if (!this.isIdentifierLike(tok)) {
                this.error(tok, "Expected import name");
              }
              const name = tok.value;
              this.advance();
              let alias = void 0;
              if (this.checkContextualKeyword("as") || this.checkKeyword("as")) {
                this.advance();
                const aliasTok = this.peek();
                if (!this.isIdentifierLike(aliasTok)) {
                  this.error(aliasTok, "Expected alias name");
                }
                alias = aliasTok.value;
                this.advance();
              }
              namedImports.push({ type: "ImportSpecifier", name, alias });
            } while (this.matchDelimiter(","));
          }
          this.consumeDelimiter("}", "Expected '}'");
        } else if (this.checkOperator("*")) {
          this.advance();
          const asTok = this.peek();
          if ((asTok.type === "Identifier" || asTok.type === "Keyword") && asTok.value === "as") {
            this.advance();
          } else {
            this.error(asTok, "Expected 'as' after '*'");
          }
          const tok = this.peek();
          if (!this.isIdentifierLike(tok)) {
            this.error(tok, "Expected module name");
          }
          defaultImport = "* as " + tok.value;
          this.advance();
        } else {
          const tok = this.peek();
          if (!this.isIdentifierLike(tok)) {
            this.error(tok, "Expected module name");
          }
          defaultImport = tok.value;
          this.advance();
        }
        this.consumeKeyword("from");
        const srcTok = this.peek();
        if (srcTok.type !== "String" && srcTok.type !== "RawString") {
          this.error(srcTok, "Expected module source string");
        }
        this.advance();
        return { type: "ImportDeclaration", defaultImport, namedImports, source: srcTok.value };
      }
      parseExportDeclaration() {
        this.consumeKeyword("export");
        if (this.checkKeyword("default")) {
          this.advance();
          const declaration2 = this.parseStatement();
          return { type: "ExportDeclaration", declaration: declaration2, isDefault: true };
        }
        if (this.checkOperator("*")) {
          this.advance();
          let exportAllAlias = void 0;
          if (this.checkContextualKeyword("as")) {
            this.advance();
            exportAllAlias = this.consumeIdentifier("Expected alias name").name;
          }
          this.consumeKeyword("from");
          const allSource = this.peek().value;
          this.advance();
          return { type: "ExportDeclaration", isDefault: false, exportAll: true, source: allSource, exportAllAlias };
        }
        if (this.checkDelimiter("{")) {
          this.advance();
          const namedExports = [];
          while (!this.checkDelimiter("}") && !this.isAtEnd()) {
            const name = this.consumeIdentifier("Expected export name").name;
            let alias = void 0;
            if (this.checkContextualKeyword("as")) {
              this.advance();
              alias = this.consumeIdentifier("Expected alias name").name;
            }
            namedExports.push({ type: "ExportSpecifier", name, alias });
            if (!this.matchDelimiter(",")) {
              break;
            }
          }
          this.consumeDelimiter("}", "Expected '}'");
          let source = void 0;
          if (this.checkKeyword("from")) {
            this.advance();
            source = this.peek().value;
            this.advance();
          }
          return { type: "ExportDeclaration", isDefault: false, namedExports, source };
        }
        const declaration = this.parseStatement();
        return { type: "ExportDeclaration", declaration, isDefault: false };
      }
      parseClassDeclaration() {
        this.consumeKeyword("class");
        const name = this.consumeIdentifier("Expected class name");
        const typeParams = this.parseTypeParams();
        let superClass = null;
        if (this.checkKeyword("extends")) {
          this.advance();
          superClass = this.consumeIdentifier("Expected superclass name");
        }
        let implementsList = void 0;
        if (this.checkContextualKeyword("implements")) {
          this.advance();
          implementsList = [];
          do {
            implementsList.push(this.consumeIdentifier("Expected interface name after 'implements'"));
          } while (this.checkDelimiter(",") && this.advance());
        }
        this.consumeDelimiter("{", `Expected '{'`);
        const body = [];
        while (!this.checkDelimiter("}") && !this.isAtEnd()) {
          let isStatic = false;
          let isAsync = false;
          let kind = "method";
          if (this.checkKeyword("static")) {
            isStatic = true;
            this.advance();
          }
          if (this.checkKeyword("async")) {
            isAsync = true;
            this.advance();
          }
          if (this.peek().type === "Identifier" && (this.peek().value === "get" || this.peek().value === "set")) {
            const next = this.peekNext();
            if (next && (next.type === "Identifier" || next.type === "Delimiter" && next.value === "[")) {
              kind = this.peek().value;
              this.advance();
            }
          }
          let isGenerator = false;
          if (this.checkKeyword("fn")) {
            this.advance();
            if (this.checkOperator("*")) {
              isGenerator = true;
              this.advance();
            }
          }
          let memberName = null;
          let computed = false;
          if (this.checkDelimiter("[")) {
            computed = true;
            this.advance();
            memberName = this.parseExpression();
            this.consumeDelimiter("]", "Expected ']'");
          } else {
            memberName = this.consumeIdentifier("Expected member name");
          }
          if (!computed && memberName.name === "constructor") {
            kind = "constructor";
          }
          if (this.checkDelimiter("(")) {
            this.consumeDelimiter("(", "Expected '('");
            const params = this.parseParamList();
            this.consumeDelimiter(")", "Expected ')'");
            let returnType = void 0;
            if (this.checkDelimiter(":")) {
              this.advance();
              returnType = this.parseTypeAnnotation();
            }
            const methodBody = this.parseBlock();
            body.push({ type: "ClassMethod", name: memberName, params, body: methodBody, async: isAsync, generator: isGenerator, static: isStatic, kind, computed, returnType });
          } else {
            let value = null;
            if (this.checkOperator("=")) {
              this.advance();
              value = this.parseExpression();
            }
            body.push({ type: "ClassField", name: memberName, value, static: isStatic, computed });
          }
        }
        this.consumeDelimiter("}", "Expected '}'");
        return { type: "ClassDeclaration", name, superClass, implements: implementsList, body, typeParams };
      }
      parseTryCatch() {
        this.consumeKeyword("try");
        const tryBlock = this.parseBlock();
        let catchParam = null;
        let catchBlock = [];
        let finallyBlock = null;
        if (this.checkKeyword("catch")) {
          this.consumeKeyword("catch");
          if (this.checkDelimiter("(")) {
            this.advance();
            catchParam = this.consumeIdentifier("Expected catch parameter");
            this.consumeDelimiter(")", "Expected ')'");
          } else if (this.peek().type === "Identifier") {
            catchParam = this.consumeIdentifier("Expected catch parameter");
          }
          catchBlock = this.parseBlock();
        }
        if (this.checkKeyword("finally")) {
          this.advance();
          finallyBlock = this.parseBlock();
        }
        return { type: "TryCatchStatement", tryBlock, catchParam, catchBlock, finallyBlock };
      }
      parseThrowStatement() {
        this.consumeKeyword("throw");
        const value = this.parseExpression();
        return { type: "ThrowStatement", value };
      }
      parseConstDeclaration() {
        this.consumeKeyword("const");
        return this.parseVariableOrDestructuring("const");
      }
      parseLetDeclaration() {
        this.consumeKeyword("let");
        return this.parseVariableOrDestructuring("let");
      }
      parseVarDeclaration() {
        this.consumeKeyword("var");
        return this.parseVariableOrDestructuring("var");
      }
      parseVariableOrDestructuring(kind) {
        if (this.checkDelimiter("{")) {
          const pattern = this.parseObjectPattern();
          this.consumeOperator("=", "Expected '=' after destructuring pattern");
          const value = this.parseExpression();
          return { type: "DestructuringDeclaration", pattern, value, kind };
        }
        if (this.checkDelimiter("[")) {
          const pattern = this.parseArrayPattern();
          this.consumeOperator("=", "Expected '=' after destructuring pattern");
          const value = this.parseExpression();
          return { type: "DestructuringDeclaration", pattern, value, kind };
        }
        return this.parseVariableDeclaration(kind);
      }
      parseVariableDeclaration(kind) {
        const name = this.consumeIdentifier("Expected variable name");
        let typeAnnotation = void 0;
        if (this.checkDelimiter(":")) {
          this.advance();
          typeAnnotation = this.parseTypeAnnotation();
        }
        this.consumeOperator("=", "Expected '=' in assignment");
        const value = this.parseExpression();
        return { type: "VariableDeclaration", name, value, kind, typeAnnotation };
      }
      parseSwitchStatement() {
        this.consumeKeyword("switch");
        const discriminant = this.parseExpression();
        this.consumeDelimiter("{", `Expected '{'`);
        const cases = [];
        while (!this.checkDelimiter("}") && !this.isAtEnd()) {
          if (this.checkKeyword("case")) {
            this.advance();
            const test = this.parseExpression();
            this.consumeDelimiter("{", `Expected '{'`);
            const consequent = [];
            while (!this.checkDelimiter("}") && !this.isAtEnd()) {
              consequent.push(this.parseStatement());
            }
            this.consumeDelimiter("}", "Expected '}'");
            cases.push({ type: "SwitchCase", test, consequent });
          } else if (this.checkKeyword("default")) {
            this.advance();
            this.consumeDelimiter("{", `Expected '{'`);
            const consequent = [];
            while (!this.checkDelimiter("}") && !this.isAtEnd()) {
              consequent.push(this.parseStatement());
            }
            this.consumeDelimiter("}", "Expected '}'");
            cases.push({ type: "SwitchCase", test: null, consequent });
          } else {
            this.error(this.peek(), "Expected 'case' or 'default'");
          }
        }
        this.consumeDelimiter("}", "Expected '}'");
        return { type: "SwitchStatement", discriminant, cases };
      }
      parseMatchStatement() {
        this.consumeKeyword("match");
        const discriminant = this.parseExpression();
        this.consumeDelimiter("{", `Expected '{'`);
        const cases = [];
        while (!this.checkDelimiter("}") && !this.isAtEnd()) {
          if (this.checkKeyword("case")) {
            this.advance();
            const pattern = this.parseExpression();
            let guard = void 0;
            if (this.checkKeyword("if")) {
              this.advance();
              guard = this.parseExpression();
            }
            const body = this.parseBlock();
            cases.push({ type: "MatchCase", pattern, guard, body });
          } else if (this.checkKeyword("default")) {
            this.advance();
            const body = this.parseBlock();
            cases.push({ type: "MatchCase", pattern: null, body });
          } else {
            this.error(this.peek(), "Expected 'case' or 'default' in match");
          }
        }
        this.consumeDelimiter("}", "Expected '}'");
        return { type: "MatchStatement", discriminant, cases };
      }
      parseEnumDeclaration() {
        this.consumeKeyword("enum");
        const nameTok = this.advance();
        if (nameTok.type !== "Identifier") {
          this.error(nameTok, "Expected enum name");
        }
        const name = { type: "Identifier", name: nameTok.value };
        this.consumeDelimiter("{", `Expected '{' after enum name`);
        const members = [];
        while (!this.checkDelimiter("}") && !this.isAtEnd()) {
          const memberTok = this.advance();
          if (memberTok.type !== "Identifier" && memberTok.type !== "Keyword") {
            this.error(memberTok, "Expected enum member name");
          }
          const memberName = { type: "Identifier", name: memberTok.value };
          let value = null;
          if (this.checkOperator("=")) {
            this.advance();
            value = this.parseExpression();
          }
          members.push({ type: "EnumMember", name: memberName, value });
          if (this.checkDelimiter(",")) {
            this.advance();
          }
        }
        this.consumeDelimiter("}", "Expected '}' after enum body");
        return { type: "EnumDeclaration", name, members };
      }
      parseInterfaceDeclaration() {
        this.consumeKeyword("interface");
        const nameTok = this.advance();
        if (nameTok.type !== "Identifier") {
          this.error(nameTok, "Expected interface name");
        }
        const name = { type: "Identifier", name: nameTok.value };
        let extendsIds = void 0;
        if (this.checkKeyword("extends")) {
          this.advance();
          extendsIds = [];
          do {
            const extTok = this.advance();
            if (extTok.type !== "Identifier") {
              this.error(extTok, "Expected interface name after 'extends'");
            }
            extendsIds.push({ type: "Identifier", name: extTok.value });
          } while (this.matchDelimiter(","));
        }
        this.consumeDelimiter("{", `Expected '{' after interface name`);
        const properties = [];
        while (!this.checkDelimiter("}") && !this.isAtEnd()) {
          const propTok = this.advance();
          if (propTok.type !== "Identifier") {
            this.error(propTok, "Expected property name in interface");
          }
          const propName = { type: "Identifier", name: propTok.value };
          let optional = false;
          if (this.checkOperator("?")) {
            this.advance();
            optional = true;
          }
          if (this.checkDelimiter("(")) {
            this.advance();
            const params = [];
            while (!this.checkDelimiter(")") && !this.isAtEnd()) {
              this.advance();
              if (this.checkDelimiter(":")) {
                this.advance();
                params.push(this.parseTypeAnnotation());
              }
              if (this.checkDelimiter(",")) {
                this.advance();
              }
            }
            this.consumeDelimiter(")", "Expected ')' in method signature");
            let returnType = { kind: "named", name: "void" };
            if (this.checkDelimiter(":")) {
              this.advance();
              returnType = this.parseTypeAnnotation();
            }
            properties.push({ type: "InterfaceProperty", name: propName, valueType: returnType, optional, method: true, params });
          } else {
            this.consumeDelimiter(":", "Expected ':' after property name");
            const valueType = this.parseTypeAnnotation();
            properties.push({ type: "InterfaceProperty", name: propName, valueType, optional, method: false });
          }
          if (this.checkDelimiter(",") || this.checkDelimiter(";")) {
            this.advance();
          }
        }
        this.consumeDelimiter("}", "Expected '}' after interface body");
        return { type: "InterfaceDeclaration", name, properties, extends: extendsIds };
      }
      parseTypeOrADT() {
        this.consumeContextualKeyword("type");
        const name = this.consumeIdentifier("Expected type alias name");
        const typeParams = this.parseTypeParams();
        this.consumeOperator("=", "Expected '=' after type alias name");
        const cur = this.peek();
        const next = this.peekNext();
        if (cur.type === "Identifier" && /^[A-Z]/.test(cur.value)) {
          if (next?.type === "Delimiter" && (next.value === "(" || next.value === "|") || next?.type === "Operator" && next.value === "|") {
            return this.parseADTVariants(name, typeParams);
          }
        }
        const value = this.parseTypeAnnotation();
        return { type: "TypeAliasDeclaration", name, typeParams, value };
      }
      parseADTVariants(name, typeParams) {
        const variants = [];
        variants.push(this.parseOneVariant());
        while ((this.checkOperator("|") || this.checkDelimiter("|")) && !this.isAtEnd()) {
          this.advance();
          variants.push(this.parseOneVariant());
        }
        return { type: "ADTDeclaration", name, typeParams, variants };
      }
      parseOneVariant() {
        const vName = this.consumeIdentifier("Expected variant name");
        const fields = [];
        if (this.checkDelimiter("(")) {
          this.advance();
          if (!this.checkDelimiter(")")) {
            do {
              if (this.checkDelimiter(")")) {
                break;
              }
              let fieldName = null;
              let typeAnnotation = void 0;
              const cur = this.peek();
              const next = this.peekNext();
              if ((cur.type === "Identifier" || this.isIdentifierLike(cur)) && next && next.type === "Delimiter" && next.value === ":") {
                fieldName = { type: "Identifier", name: cur.value };
                this.advance();
                this.advance();
                typeAnnotation = this.parseTypeAnnotation();
              } else {
                typeAnnotation = this.parseTypeAnnotation();
              }
              fields.push({ type: "ADTField", name: fieldName, typeAnnotation });
            } while (this.matchDelimiter(","));
          }
          this.consumeDelimiter(")", "Expected ')'");
        }
        return { type: "ADTVariant", name: vName, fields };
      }
      parseGoStatement() {
        this.consumeKeyword("go");
        if (this.checkDelimiter(`{`)) {
          const body = this.parseBlock();
          return { type: "GoStatement", expression: null, body };
        }
        const expression = this.parseExpression();
        return { type: "GoStatement", expression, body: null };
      }
    };
  }
});

// dist/compiler/parser/parser.js
var Parser;
var init_parser = __esm({
  "dist/compiler/parser/parser.js"() {
    init_parser_statements();
    Parser = class extends ParserStatements {
      constructor(tokens, source) {
        super(tokens, source);
        this.errors = [];
      }
      parseProgram() {
        const body = [];
        while (!this.isAtEnd()) {
          try {
            body.push(this.parseStatement());
          } catch (err) {
            if (err instanceof SyntaxError) {
              this.errors.push(err);
              this.recover();
            } else {
              throw err;
            }
          }
        }
        return { type: "Program", body, errors: this.errors };
      }
      recover() {
        let braceDepth = 0;
        while (!this.isAtEnd()) {
          const tok = this.peek();
          if (tok.type === "Delimiter" && tok.value === "{") {
            braceDepth = braceDepth + 1;
            this.advance();
            continue;
          }
          if (tok.type === "Delimiter" && tok.value === "}") {
            if (braceDepth > 0) {
              braceDepth = braceDepth - 1;
              this.advance();
              continue;
            }
            this.advance();
            return;
          }
          if (tok.type === "Delimiter" && tok.value === ";" && braceDepth === 0) {
            this.advance();
            return;
          }
          if (braceDepth === 0 && tok.type === "Keyword" && ["fn", "if", "for", "while", "do", "return", "import", "export", "class", "try", "throw", "const", "let", "var", "switch", "match", "enum", "interface", "break", "continue"].includes(tok.value)) {
            return;
          }
          this.advance();
        }
      }
      parseDecorators() {
        const decorators = [];
        while (this.peek().type === "Decorator") {
          const tok = this.advance();
          const name = tok.value.slice(1);
          let args = void 0;
          if (this.checkDelimiter("(")) {
            this.advance();
            args = [];
            if (!this.checkDelimiter(")")) {
              do {
                args.push(this.parseExpression());
              } while (this.matchDelimiter(","));
            }
            this.consumeDelimiter(")", "Expected ')' after decorator arguments");
          }
          decorators.push({ type: "Decorator", name, arguments: args });
        }
        return decorators;
      }
      parseStatement() {
        const decorators = this.parseDecorators();
        const tok = this.peek();
        const loc = tok.loc ? { line: tok.loc.line, column: tok.loc.column } : void 0;
        let stmt = null;
        if (tok.type === "Keyword") {
          switch (tok.value) {
            case "fn": {
              const next = this.peekNext();
              stmt = this.parseFunctionDeclaration(false, next?.type === "Operator" && next?.value === "*");
              break;
            }
            case "async": {
              stmt = this.parseAsync();
              break;
            }
            case "if": {
              stmt = this.parseIfStatement();
              break;
            }
            case "for": {
              stmt = this.parseForStatement();
              break;
            }
            case "while": {
              stmt = this.parseWhileStatement();
              break;
            }
            case "do": {
              stmt = this.parseDoWhileStatement();
              break;
            }
            case "return": {
              stmt = this.parseReturnStatement();
              break;
            }
            case "import": {
              stmt = this.parseImportDeclaration();
              break;
            }
            case "export": {
              stmt = this.parseExportDeclaration();
              break;
            }
            case "class": {
              stmt = this.parseClassDeclaration();
              break;
            }
            case "try": {
              stmt = this.parseTryCatch();
              break;
            }
            case "throw": {
              stmt = this.parseThrowStatement();
              break;
            }
            case "const": {
              stmt = this.parseConstDeclaration();
              break;
            }
            case "let": {
              stmt = this.parseLetDeclaration();
              break;
            }
            case "var": {
              stmt = this.parseVarDeclaration();
              break;
            }
            case "switch": {
              stmt = this.parseSwitchStatement();
              break;
            }
            case "match": {
              stmt = this.parseMatchStatement();
              break;
            }
            case "enum": {
              stmt = this.parseEnumDeclaration();
              break;
            }
            case "interface": {
              stmt = this.parseInterfaceDeclaration();
              break;
            }
            case "break": {
              this.advance();
              let breakLabel = void 0;
              if (this.peek().type === "Identifier") {
                breakLabel = this.peek().value;
                this.advance();
              }
              stmt = { type: "BreakStatement", label: breakLabel };
              break;
            }
            case "continue": {
              this.advance();
              let contLabel = void 0;
              if (this.peek().type === "Identifier") {
                contLabel = this.peek().value;
                this.advance();
              }
              stmt = { type: "ContinueStatement", label: contLabel };
              break;
            }
            case "debugger": {
              this.advance();
              stmt = { type: "DebuggerStatement" };
              break;
            }
            case "go": {
              stmt = this.parseGoStatement();
              break;
            }
            default: {
              stmt = this.parseExpressionStatement();
              break;
            }
          }
        } else if (tok.type === "Identifier") {
          if (tok.value === "type" && this.peekNext()?.type === "Identifier") {
            stmt = this.parseTypeOrADT();
            if (loc) {
              stmt.loc = loc;
            }
            return stmt;
          }
          const next = this.peekNext();
          if (next?.type === "Delimiter" && next.value === ":") {
            const after = this.peekAt(2);
            if (after?.type === "Keyword" && (after.value === "for" || after.value === "while" || after.value === "do")) {
              const label = tok.value;
              this.advance();
              this.advance();
              const body = this.parseStatement();
              stmt = { type: "LabeledStatement", label, body };
            } else {
              stmt = this.parseIdentifierStatement(tok, next);
            }
          } else {
            stmt = this.parseIdentifierStatement(tok, next);
          }
        } else {
          stmt = this.parseExpressionStatement();
        }
        if (decorators.length > 0) {
          if (stmt.type === "FunctionDeclaration") {
            stmt.decorators = decorators;
          }
          if (stmt.type === "ClassDeclaration") {
            stmt.decorators = decorators;
          }
          if (stmt.type === "ExportDeclaration" && stmt.declaration) {
            if (stmt.declaration.type === "FunctionDeclaration") {
              stmt.declaration.decorators = decorators;
            }
            if (stmt.declaration.type === "ClassDeclaration") {
              stmt.declaration.decorators = decorators;
            }
          }
        }
        if (loc) {
          stmt.loc = loc;
        }
        return stmt;
      }
      parseIdentifierStatement(tok, next) {
        if (next?.type === "Operator" && next.value === "=") {
          const afterEq = this.peekAt(2);
          if (afterEq?.type !== "Operator" || afterEq.value !== "=" && afterEq.value !== ">") {
            return this.parseVariableDeclaration("let");
          }
        }
        if (next?.type === "Delimiter" && next.value === ":") {
          return this.parseVariableDeclaration("let");
        }
        return this.parseExpressionStatement();
      }
    };
  }
});

// dist/compiler/resolver.js
var resolver_exports = {};
__export(resolver_exports, {
  resolveImport: () => resolveImport,
  rewriteImportSource: () => rewriteImportSource
});
function resolveImport(source, fromFile) {
  if (!source.startsWith(".") && !source.startsWith("/")) {
    return null;
  }
  const dir = (0, import_path.dirname)(fromFile);
  const candidates = [(0, import_path.join)(dir, source.endsWith(".no") ? source : source + ".no"), (0, import_path.join)(dir, source, "index.no")];
  for (const candidate of candidates) {
    const abs = (0, import_path.resolve)(candidate);
    if ((0, import_fs.existsSync)(abs)) {
      return abs;
    }
  }
  return null;
}
function rewriteImportSource(source) {
  if (!source.startsWith(".") && !source.startsWith("/")) {
    return source;
  }
  if (source.endsWith(".js") || source.endsWith(".mjs") || source.endsWith(".json")) {
    return source;
  }
  if (source.endsWith(".no")) {
    return source.slice(0, -3) + ".js";
  }
  return source + ".js";
}
var import_fs, import_path;
var init_resolver = __esm({
  "dist/compiler/resolver.js"() {
    import_fs = require("fs");
    import_path = require("path");
  }
});

// dist/compiler/generator/source-map.js
function vlqEncode(value) {
  let vlq = value < 0 ? (-value << 1) + 1 : value << 1;
  let encoded = "";
  do {
    let digit = vlq & VLQ_BASE_MASK;
    vlq = vlq >>> VLQ_BASE_SHIFT;
    if (vlq > 0) {
      digit = digit | VLQ_CONTINUATION_BIT;
    }
    encoded = encoded + VLQ_BASE64[digit];
  } while (vlq > 0);
  return encoded;
}
var VLQ_BASE64, VLQ_BASE_SHIFT, VLQ_BASE, VLQ_BASE_MASK, VLQ_CONTINUATION_BIT, SourceMapBuilder;
var init_source_map = __esm({
  "dist/compiler/generator/source-map.js"() {
    VLQ_BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    VLQ_BASE_SHIFT = 5;
    VLQ_BASE = 1 << VLQ_BASE_SHIFT;
    VLQ_BASE_MASK = VLQ_BASE - 1;
    VLQ_CONTINUATION_BIT = VLQ_BASE;
    SourceMapBuilder = class {
      constructor() {
        this.mappings = [];
        this.sources = [];
        this.sourcesContent = [];
        this.names = [];
      }
      addSource(filename, content) {
        const idx = this.sources.indexOf(filename);
        if (idx >= 0) {
          return idx;
        }
        this.sources.push(filename);
        this.sourcesContent.push(content ?? null);
        return this.sources.length - 1;
      }
      addMapping(mapping) {
        return this.mappings.push(mapping);
      }
      addLineMapping(sourceLine, generatedLine, sourceIndex) {
        return this.mappings.push({ generatedLine, generatedColumn: 0, sourceLine, sourceColumn: 0, sourceIndex: sourceIndex ?? 0 });
      }
      toJSON(outputFile) {
        return { version: 3, file: outputFile, sourceRoot: "", sources: this.sources, sourcesContent: this.sourcesContent, names: this.names, mappings: this.encodeMappings() };
      }
      toString(outputFile) {
        return JSON.stringify(this.toJSON(outputFile));
      }
      encodeMappings() {
        const sorted = [...this.mappings].sort((a, b) => a.generatedLine - b.generatedLine || a.generatedColumn - b.generatedColumn);
        if (sorted.length === 0) {
          return "";
        }
        const lines = [];
        let prevGenLine = 1;
        let prevGenCol = 0;
        let prevSourceIndex = 0;
        let prevSourceLine = 0;
        let prevSourceCol = 0;
        for (const m of sorted) {
          while (prevGenLine < m.generatedLine) {
            lines.push([]);
            prevGenLine = prevGenLine + 1;
            prevGenCol = 0;
          }
          if (!lines[lines.length - 1]) {
            lines.push([]);
          }
          const segment = vlqEncode(m.generatedColumn - prevGenCol) + vlqEncode(m.sourceIndex - prevSourceIndex) + vlqEncode(m.sourceLine - 1 - prevSourceLine) + vlqEncode(m.sourceColumn - prevSourceCol);
          lines[lines.length - 1].push(segment);
          prevGenCol = m.generatedColumn;
          prevSourceIndex = m.sourceIndex;
          prevSourceLine = m.sourceLine - 1;
          prevSourceCol = m.sourceColumn;
        }
        return lines.map((segs) => segs.join(",")).join(";");
      }
    };
  }
});

// dist/compiler/generator/js-generator.js
function generateJS(program, minify) {
  const min = minify ?? false;
  const nl = min ? "" : "\n";
  const sp = min ? "" : " ";
  const ctx = { minify: min, nl, sp, indentLevel: 0, indentSize: 2, declaredVars: /* @__PURE__ */ new Set() };
  const lines = program.body.map((stmt) => emitStatement(stmt, ctx));
  return lines.join(nl);
}
function generateJSWithSourceMap(program, sourceFile, sourceContent, outputFile, minify) {
  const builder = new SourceMapBuilder();
  const sourceIndex = builder.addSource(sourceFile, sourceContent);
  const min = minify ?? false;
  const nl = min ? "" : "\n";
  const sp = min ? "" : " ";
  const ctx = { minify: min, nl, sp, indentLevel: 0, indentSize: 2, declaredVars: /* @__PURE__ */ new Set() };
  const outputLines = [];
  for (const stmt of program.body) {
    const code2 = emitStatement(stmt, ctx);
    const genLine = outputLines.length + 1;
    if (stmt.loc) {
      builder.addLineMapping(stmt.loc.line, genLine, sourceIndex);
    }
    const codeLines = code2.split("\n");
    if (codeLines.length > 1) {
      const innerLocs = collectInnerLocs(stmt);
      outputLines.push(codeLines[0]);
      let i = 1;
      while (i < codeLines.length) {
        const innerLoc = innerLocs[i - 1];
        if (innerLoc) {
          builder.addLineMapping(innerLoc.line, genLine + i, sourceIndex);
        } else if (stmt.loc) {
          builder.addLineMapping(stmt.loc.line, genLine + i, sourceIndex);
        }
        outputLines.push(codeLines[i]);
        i = i + 1;
      }
    } else {
      outputLines.push(code2);
    }
  }
  const js = outputLines.join(nl) + nl + "//# sourceMappingURL=" + outputFile + ".map";
  const sourceMap = builder.toJSON(outputFile);
  return { js, sourceMap };
}
function collectInnerLocs(stmt) {
  const locs = [];
  const collect = (stmts) => {
    for (const s of stmts) {
      if (s.loc) {
        locs.push({ line: s.loc.line, column: s.loc.column });
      } else {
        locs.push(null);
      }
      if (s.type === "IfStatement") {
        collect(s.consequent);
        if (s.alternate) {
          collect(s.alternate);
        }
      } else if (s.type === "ForStatement" || s.type === "WhileStatement") {
        collect(s.body);
      } else if (s.type === "TryCatchStatement") {
        collect(s.tryBlock);
        collect(s.catchBlock);
        if (s.finallyBlock) {
          collect(s.finallyBlock);
        }
      }
    }
  };
  if (stmt.type === "FunctionDeclaration") {
    collect(stmt.body);
  }
  if (stmt.type === "ClassDeclaration") {
    for (const m of stmt.body) {
      if (m.type === "ClassMethod") {
        collect(m.body);
      }
    }
  }
  if (stmt.type === "IfStatement") {
    collect(stmt.consequent);
    if (stmt.alternate) {
      collect(stmt.alternate);
    }
  }
  if (stmt.type === "ForStatement" || stmt.type === "WhileStatement") {
    collect(stmt.body);
  }
  if (stmt.type === "TryCatchStatement") {
    collect(stmt.tryBlock);
    collect(stmt.catchBlock);
    if (stmt.finallyBlock) {
      collect(stmt.finallyBlock);
    }
  }
  if (stmt.type === "SwitchStatement") {
    for (const c of stmt.cases) {
      collect(c.consequent);
    }
  }
  if (stmt.type === "MatchStatement") {
    for (const c of stmt.cases) {
      collect(c.body);
    }
  }
  return locs;
}
function pad(ctx) {
  if (ctx.minify) {
    return "";
  }
  return " ".repeat(ctx.indentLevel * ctx.indentSize);
}
function indented(ctx) {
  return { minify: ctx.minify, nl: ctx.nl, sp: ctx.sp, indentLevel: ctx.indentLevel + 1, indentSize: ctx.indentSize, declaredVars: ctx.declaredVars };
}
function childScope(ctx) {
  return { minify: ctx.minify, nl: ctx.nl, sp: ctx.sp, indentLevel: ctx.indentLevel, indentSize: ctx.indentSize, declaredVars: new Set(ctx.declaredVars) };
}
function emitStatement(stmt, ctx) {
  switch (stmt.type) {
    case "FunctionDeclaration": {
      return emitFunction(stmt, ctx);
    }
    case "VariableDeclaration": {
      return emitVariable(stmt, ctx);
    }
    case "ExpressionStatement": {
      return emitExpression(stmt.expression, ctx) + ";";
    }
    case "IfStatement": {
      return emitIf(stmt, ctx);
    }
    case "ForStatement": {
      return emitFor(stmt, ctx);
    }
    case "WhileStatement": {
      return emitWhile(stmt, ctx);
    }
    case "DoWhileStatement": {
      return emitDoWhile(stmt, ctx);
    }
    case "ReturnStatement": {
      return emitReturn(stmt, ctx);
    }
    case "ImportDeclaration": {
      return emitImport(stmt, ctx);
    }
    case "ExportDeclaration": {
      return emitExport(stmt, ctx);
    }
    case "ClassDeclaration": {
      return emitClass(stmt, ctx);
    }
    case "TryCatchStatement": {
      return emitTryCatch(stmt, ctx);
    }
    case "ThrowStatement": {
      return "throw " + emitExpression(stmt.value, ctx) + ";";
    }
    case "SwitchStatement": {
      return emitSwitch(stmt, ctx);
    }
    case "BreakStatement": {
      return stmt.label ? "break " + stmt.label + ";" : "break;";
    }
    case "ContinueStatement": {
      return stmt.label ? "continue " + stmt.label + ";" : "continue;";
    }
    case "DestructuringDeclaration": {
      return emitDestructuring(stmt, ctx);
    }
    case "MatchStatement": {
      return emitMatch(stmt, ctx);
    }
    case "EnumDeclaration": {
      return emitEnum(stmt, ctx);
    }
    case "InterfaceDeclaration": {
      return "";
    }
    case "TypeAliasDeclaration": {
      return "";
    }
    case "ADTDeclaration": {
      return emitADT(stmt, ctx);
    }
    case "GoStatement": {
      return emitGo(stmt, ctx);
    }
    case "DebuggerStatement": {
      return "debugger;";
    }
    case "LabeledStatement": {
      return stmt.label + ": " + emitStatement(stmt.body, ctx);
    }
    default: {
      throw new Error("Unsupported statement type: " + stmt.type);
    }
  }
}
function emitFunction(f, ctx) {
  const asyncPrefix = f.async ? "async " : "";
  const star = f.generator ? "*" : "";
  const params = f.params.map((p) => emitParam(p, ctx)).join("," + ctx.sp);
  const fnScope = childScope(indented(ctx));
  f.params.forEach((p) => {
    fnScope.declaredVars.add(p.name);
  });
  let body = "";
  if (!f.generator && f.body.length === 1 && f.body[0].type === "ExpressionStatement") {
    body = pad(fnScope) + "return " + emitExpression(f.body[0].expression, fnScope) + ";";
  } else {
    body = f.body.map((s) => pad(fnScope) + emitStatement(s, fnScope)).join(ctx.nl);
  }
  let result = asyncPrefix + "function" + star + " " + f.name.name + "(" + params + ")" + ctx.sp + "{" + ctx.nl + body + ctx.nl + pad(ctx) + "}";
  if (f.decorators && f.decorators.length > 0) {
    for (const dec of f.decorators) {
      const args = dec.arguments ? dec.arguments.map((a) => emitExpression(a, ctx)).join("," + ctx.sp) : "";
      if (dec.arguments) {
        result = result + ctx.nl + pad(ctx) + f.name.name + ctx.sp + "=" + ctx.sp + dec.name + "(" + args + ")(" + f.name.name + ");";
      } else {
        result = result + ctx.nl + pad(ctx) + f.name.name + ctx.sp + "=" + ctx.sp + dec.name + "(" + f.name.name + ");";
      }
    }
  }
  return result;
}
function emitParam(p, ctx) {
  let out = "";
  if (p.rest) {
    out = out + "...";
  }
  if (p.pattern) {
    out = out + emitPattern(p.pattern, ctx);
  } else {
    out = out + p.name;
  }
  if (p.defaultValue) {
    out = out + ctx.sp + "=" + ctx.sp + emitExpression(p.defaultValue, ctx);
  }
  return out;
}
function emitVariable(v, ctx) {
  const name = v.name.name;
  const keyword = v.kind;
  if (keyword === "let" && ctx.declaredVars.has(name)) {
    return name + ctx.sp + "=" + ctx.sp + emitExpression(v.value, ctx) + ";";
  }
  ctx.declaredVars.add(name);
  return keyword + " " + name + ctx.sp + "=" + ctx.sp + emitExpression(v.value, ctx) + ";";
}
function emitIf(stmt, ctx) {
  const inner = indented(ctx);
  const cond2 = emitExpression(stmt.condition, ctx);
  const body = stmt.consequent.map((s) => pad(inner) + emitStatement(s, inner)).join(ctx.nl);
  let out = "if" + ctx.sp + "(" + cond2 + ")" + ctx.sp + "{" + ctx.nl + body + ctx.nl + pad(ctx) + "}";
  if (stmt.alternate) {
    if (stmt.alternate.length === 1 && stmt.alternate[0].type === "IfStatement") {
      out = out + ctx.sp + "else " + emitStatement(stmt.alternate[0], ctx);
    } else {
      const alt = stmt.alternate.map((s) => pad(inner) + emitStatement(s, inner)).join(ctx.nl);
      out = out + ctx.sp + "else" + ctx.sp + "{" + ctx.nl + alt + ctx.nl + pad(ctx) + "}";
    }
  }
  return out;
}
function emitFor(stmt, ctx) {
  const forScope = childScope(indented(ctx));
  const iter = stmt.iterable;
  const varStr = stmt.variable.type === "Identifier" ? stmt.variable.name : emitPattern(stmt.variable, ctx);
  if (stmt.variable.type === "Identifier") {
    forScope.declaredVars.add(stmt.variable.name);
  }
  const body = stmt.body.map((s) => pad(forScope) + emitStatement(s, forScope)).join(ctx.nl);
  if (iter.type === "BinaryExpression" && iter.operator === ".." && stmt.variable.type === "Identifier") {
    const start = emitExpression(iter.left, ctx);
    const end = emitExpression(iter.right, ctx);
    const v = stmt.variable.name;
    return "for" + ctx.sp + "(let " + v + ctx.sp + "=" + ctx.sp + start + ";" + ctx.sp + v + ctx.sp + "<=" + ctx.sp + end + ";" + ctx.sp + v + "++)" + ctx.sp + "{" + ctx.nl + body + ctx.nl + pad(ctx) + "}";
  }
  const jsKind = stmt.kind === "of" ? "in" : "of";
  return "for" + ctx.sp + "(const " + varStr + " " + jsKind + " " + emitExpression(iter, ctx) + ")" + ctx.sp + "{" + ctx.nl + body + ctx.nl + pad(ctx) + "}";
}
function emitWhile(stmt, ctx) {
  const whileScope = childScope(indented(ctx));
  const cond2 = emitExpression(stmt.condition, ctx);
  const body = stmt.body.map((s) => pad(whileScope) + emitStatement(s, whileScope)).join(ctx.nl);
  return "while" + ctx.sp + "(" + cond2 + ")" + ctx.sp + "{" + ctx.nl + body + ctx.nl + pad(ctx) + "}";
}
function emitDoWhile(stmt, ctx) {
  const inner = childScope(indented(ctx));
  const body = stmt.body.map((s) => pad(inner) + emitStatement(s, inner)).join(ctx.nl);
  const cond2 = emitExpression(stmt.condition, ctx);
  return "do" + ctx.sp + "{" + ctx.nl + body + ctx.nl + pad(ctx) + "}" + ctx.sp + "while" + ctx.sp + "(" + cond2 + ");";
}
function emitReturn(stmt, ctx) {
  if (!stmt.value) {
    return "return;";
  }
  return "return " + emitExpression(stmt.value, ctx) + ";";
}
function emitImport(stmt, ctx) {
  const src = rewriteImportSource(stmt.source);
  if (stmt.namedImports.length > 0) {
    const names = stmt.namedImports.map((s) => s.alias ? s.name + " as " + s.alias : s.name).join("," + ctx.sp);
    return "import" + ctx.sp + "{" + ctx.sp + names + ctx.sp + "}" + ctx.sp + "from" + ctx.sp + JSON.stringify(src) + ";";
  }
  if (stmt.defaultImport && stmt.defaultImport.startsWith("*")) {
    return "import " + stmt.defaultImport + ctx.sp + "from" + ctx.sp + JSON.stringify(src) + ";";
  }
  return "import " + stmt.defaultImport + ctx.sp + "from" + ctx.sp + JSON.stringify(src) + ";";
}
function emitExport(stmt, ctx) {
  if (stmt.exportAll) {
    const alias = stmt.exportAllAlias ? " as " + stmt.exportAllAlias : "";
    const src = rewriteImportSource(stmt.source);
    return "export *" + alias + " from " + JSON.stringify(src) + ";";
  }
  if (stmt.namedExports) {
    const names = stmt.namedExports.map((s) => s.alias ? s.name + " as " + s.alias : s.name).join("," + ctx.sp);
    const fromClause = stmt.source ? " from " + JSON.stringify(rewriteImportSource(stmt.source)) : "";
    return "export" + ctx.sp + "{" + ctx.sp + names + ctx.sp + "}" + fromClause + ";";
  }
  const kw = stmt.isDefault ? "export default" : "export";
  return kw + " " + emitStatement(stmt.declaration, ctx);
}
function emitClass(cls, ctx) {
  const inner = indented(ctx);
  const ext = cls.superClass ? " extends " + cls.superClass.name : "";
  const members = cls.body.map((m) => {
    if (m.type === "ClassField") {
      return pad(inner) + emitClassField(m, inner);
    }
    return pad(inner) + emitMethod(m, inner);
  }).join(ctx.nl + ctx.nl);
  let result = "class " + cls.name.name + ext + ctx.sp + "{" + ctx.nl + members + ctx.nl + pad(ctx) + "}";
  if (cls.decorators && cls.decorators.length > 0) {
    for (const dec of cls.decorators) {
      const args = dec.arguments ? dec.arguments.map((a) => emitExpression(a, ctx)).join("," + ctx.sp) : "";
      if (dec.arguments) {
        result = result + ctx.nl + pad(ctx) + cls.name.name + ctx.sp + "=" + ctx.sp + dec.name + "(" + args + ")(" + cls.name.name + ");";
      } else {
        result = result + ctx.nl + pad(ctx) + cls.name.name + ctx.sp + "=" + ctx.sp + dec.name + "(" + cls.name.name + ");";
      }
    }
  }
  return result;
}
function emitClassField(f, ctx) {
  const staticPrefix = f.static ? "static " : "";
  const name = f.computed ? "[" + emitExpression(f.name, ctx) + "]" : f.name.name;
  if (f.value) {
    return staticPrefix + name + ctx.sp + "=" + ctx.sp + emitExpression(f.value, ctx) + ";";
  }
  return staticPrefix + name + ";";
}
function emitMethod(m, ctx) {
  const parts = [];
  if (m.static) {
    parts.push("static");
  }
  if (m.async) {
    parts.push("async");
  }
  if (m.kind === "get") {
    parts.push("get");
  }
  if (m.kind === "set") {
    parts.push("set");
  }
  const star = m.generator ? "*" : "";
  const name = m.computed ? "[" + emitExpression(m.name, ctx) + "]" : m.name.name;
  const prefix = parts.length > 0 ? parts.join(" ") + " " : "";
  const params = m.params.map((p) => emitParam(p, ctx)).join("," + ctx.sp);
  const methScope = childScope(indented(ctx));
  m.params.forEach((p) => {
    methScope.declaredVars.add(p.name);
  });
  let body = "";
  const isConstructor = m.kind === "constructor";
  if (!isConstructor && m.body.length === 1 && m.body[0].type === "ExpressionStatement") {
    body = pad(methScope) + "return " + emitExpression(m.body[0].expression, methScope) + ";";
  } else {
    body = m.body.map((s) => pad(methScope) + emitStatement(s, methScope)).join(ctx.nl);
  }
  return prefix + star + name + "(" + params + ")" + ctx.sp + "{" + ctx.nl + body + ctx.nl + pad(ctx) + "}";
}
function emitTryCatch(stmt, ctx) {
  const inner = indented(ctx);
  const tryBody = stmt.tryBlock.map((s) => pad(inner) + emitStatement(s, inner)).join(ctx.nl);
  let out = "try" + ctx.sp + "{" + ctx.nl + tryBody + ctx.nl + pad(ctx) + "}";
  if (stmt.catchBlock.length > 0 || stmt.catchParam) {
    const catchBody = stmt.catchBlock.map((s) => pad(inner) + emitStatement(s, inner)).join(ctx.nl);
    const param = stmt.catchParam ? ctx.sp + "(" + stmt.catchParam.name + ")" : "";
    out = out + ctx.sp + "catch" + param + ctx.sp + "{" + ctx.nl + catchBody + ctx.nl + pad(ctx) + "}";
  }
  if (stmt.finallyBlock) {
    const finallyBody = stmt.finallyBlock.map((s) => pad(inner) + emitStatement(s, inner)).join(ctx.nl);
    out = out + ctx.sp + "finally" + ctx.sp + "{" + ctx.nl + finallyBody + ctx.nl + pad(ctx) + "}";
  }
  return out;
}
function emitSwitch(stmt, ctx) {
  const inner = indented(ctx);
  const caseInner = indented(inner);
  const disc = emitExpression(stmt.discriminant, ctx);
  const cases = stmt.cases.map((c) => {
    const header = c.test ? pad(inner) + "case " + emitExpression(c.test, inner) + ":" : pad(inner) + "default:";
    const body = c.consequent.map((s) => pad(caseInner) + emitStatement(s, caseInner)).join(ctx.nl);
    const last = c.consequent.length > 0 ? c.consequent[c.consequent.length - 1] : null;
    const exits = last && (last.type === "BreakStatement" || last.type === "ReturnStatement" || last.type === "ThrowStatement" || last.type === "ContinueStatement");
    const brk = exits ? "" : ctx.nl + pad(caseInner) + "break;";
    return header + ctx.sp + "{" + ctx.nl + body + brk + ctx.nl + pad(inner) + "}";
  }).join(ctx.nl);
  return "switch" + ctx.sp + "(" + disc + ")" + ctx.sp + "{" + ctx.nl + cases + ctx.nl + pad(ctx) + "}";
}
function emitMatch(stmt, ctx) {
  const inner = indented(ctx);
  const disc = emitExpression(stmt.discriminant, ctx);
  const parts = [];
  let i = 0;
  while (i < stmt.cases.length) {
    const c = stmt.cases[i];
    if (c.pattern === null) {
      const body = c.body.map((s) => pad(inner) + emitStatement(s, inner)).join(ctx.nl);
      parts.push(ctx.sp + "else" + ctx.sp + "{" + ctx.nl + body + ctx.nl + pad(ctx) + "}");
    } else if (c.pattern.type === "CallExpression" && c.pattern.callee.type === "Identifier") {
      const variantName = c.pattern.callee.name;
      let cond2 = disc + ".tag" + ctx.sp + "===" + ctx.sp + '"' + variantName + '"';
      if (c.guard) {
        cond2 = cond2 + ctx.sp + "&&" + ctx.sp + emitExpression(c.guard, ctx);
      }
      const bindings = [];
      let j = 0;
      while (j < c.pattern.arguments.length) {
        const arg = c.pattern.arguments[j];
        if (arg.type === "Identifier") {
          bindings.push(pad(inner) + "const " + arg.name + ctx.sp + "=" + ctx.sp + disc + "." + arg.name + ctx.sp + "!==" + ctx.sp + "undefined" + ctx.sp + "?" + ctx.sp + disc + "." + arg.name + ctx.sp + ":" + ctx.sp + disc + "._" + j + ";");
        }
        j = j + 1;
      }
      const bodyStmts = c.body.map((s) => pad(inner) + emitStatement(s, inner)).join(ctx.nl);
      const allBody = bindings.length > 0 ? bindings.join(ctx.nl) + ctx.nl + bodyStmts : bodyStmts;
      const keyword = i === 0 ? "if" : ctx.sp + "else if";
      parts.push(keyword + ctx.sp + "(" + cond2 + ")" + ctx.sp + "{" + ctx.nl + allBody + ctx.nl + pad(ctx) + "}");
    } else if (c.pattern.type === "Identifier" && /^[A-Z]/.test(c.pattern.name)) {
      cond = disc + ".tag" + ctx.sp + "===" + ctx.sp + '"' + c.pattern.name + '"';
      if (c.guard) {
        cond = cond + ctx.sp + "&&" + ctx.sp + emitExpression(c.guard, ctx);
      }
      const body = c.body.map((s) => pad(inner) + emitStatement(s, inner)).join(ctx.nl);
      const keyword = i === 0 ? "if" : ctx.sp + "else if";
      parts.push(keyword + ctx.sp + "(" + cond + ")" + ctx.sp + "{" + ctx.nl + body + ctx.nl + pad(ctx) + "}");
    } else {
      cond = disc + ctx.sp + "===" + ctx.sp + emitExpression(c.pattern, ctx);
      if (c.guard) {
        cond = cond + ctx.sp + "&&" + ctx.sp + emitExpression(c.guard, ctx);
      }
      const body = c.body.map((s) => pad(inner) + emitStatement(s, inner)).join(ctx.nl);
      const keyword = i === 0 ? "if" : ctx.sp + "else if";
      parts.push(keyword + ctx.sp + "(" + cond + ")" + ctx.sp + "{" + ctx.nl + body + ctx.nl + pad(ctx) + "}");
    }
    i = i + 1;
  }
  return parts.join("");
}
function emitEnum(stmt, ctx) {
  const inner = indented(ctx);
  const entries = [];
  let autoValue = 0;
  for (const member of stmt.members) {
    if (member.value !== null) {
      const val = emitExpression(member.value, ctx);
      entries.push(pad(inner) + member.name.name + ":" + ctx.sp + val);
      if (member.value.type === "Literal" && typeof member.value.value === "number") {
        autoValue = member.value.value + 1;
      } else {
        autoValue = autoValue + 1;
      }
    } else {
      entries.push(pad(inner) + member.name.name + ":" + ctx.sp + autoValue);
      autoValue = autoValue + 1;
    }
  }
  const body = entries.join("," + ctx.nl);
  return "const " + stmt.name.name + ctx.sp + "=" + ctx.sp + "Object.freeze({" + ctx.nl + body + ctx.nl + pad(ctx) + "});";
}
function emitADT(stmt, ctx) {
  const parts = [];
  const variantNames = [];
  for (const variant of stmt.variants) {
    const vName = variant.name.name;
    variantNames.push(vName);
    if (variant.fields.length === 0) {
      const inner = indented(ctx);
      const inner2 = indented(inner);
      parts.push("class " + vName + ctx.sp + `{` + ctx.nl + pad(inner) + "constructor()" + ctx.sp + `{` + ctx.nl + pad(inner2) + "this.tag" + ctx.sp + "=" + ctx.sp + '"' + vName + '";' + ctx.nl + pad(inner) + "}" + ctx.nl + pad(ctx) + "}");
    } else {
      const inner = indented(ctx);
      const inner2 = indented(inner);
      const fieldNames = [];
      let fi = 0;
      while (fi < variant.fields.length) {
        const f = variant.fields[fi];
        if (f.name) {
          fieldNames.push(f.name.name);
        } else {
          fieldNames.push("_" + fi);
        }
        fi = fi + 1;
      }
      const params = fieldNames.join("," + ctx.sp);
      const assignments = fieldNames.map((fn2) => pad(inner2) + "this." + fn2 + ctx.sp + "=" + ctx.sp + fn2 + ";").join(ctx.nl);
      parts.push("class " + vName + ctx.sp + `{` + ctx.nl + pad(inner) + "constructor(" + params + ")" + ctx.sp + `{` + ctx.nl + pad(inner2) + "this.tag" + ctx.sp + "=" + ctx.sp + '"' + vName + '";' + ctx.nl + assignments + ctx.nl + pad(inner) + "}" + ctx.nl + pad(ctx) + "}");
    }
  }
  const nsProps = variantNames.join("," + ctx.sp);
  parts.push("const " + stmt.name.name + ctx.sp + "=" + ctx.sp + `{` + nsProps + "};");
  return parts.join(ctx.nl);
}
function emitGo(stmt, ctx) {
  if (stmt.body) {
    const inner = indented(ctx);
    const body = stmt.body.map((s) => pad(inner) + emitStatement(s, inner)).join(ctx.nl);
    return "queueMicrotask(()" + ctx.sp + "=>" + ctx.sp + `{` + ctx.nl + body + ctx.nl + pad(ctx) + "});";
  }
  const expr = emitExpression(stmt.expression, ctx);
  return "queueMicrotask(()" + ctx.sp + "=>" + ctx.sp + expr + ");";
}
function emitDestructuring(stmt, ctx) {
  const pat = emitPattern(stmt.pattern, ctx);
  return stmt.kind + " " + pat + ctx.sp + "=" + ctx.sp + emitExpression(stmt.value, ctx) + ";";
}
function emitPattern(pattern, ctx) {
  if (pattern.type === "ObjectPattern") {
    return emitObjectPattern(pattern, ctx);
  }
  return emitArrayPattern(pattern, ctx);
}
function emitObjectPattern(pat, ctx) {
  const props = pat.properties.map((p) => {
    let out = "";
    if (p.shorthand) {
      out = p.key.name;
    } else {
      const val = p.value.type === "Identifier" ? p.value.name : emitPattern(p.value, ctx);
      out = p.key.name + ":" + ctx.sp + val;
    }
    if (p.defaultValue) {
      out = out + ctx.sp + "=" + ctx.sp + emitExpression(p.defaultValue, ctx);
    }
    return out;
  });
  if (pat.rest) {
    props.push("..." + pat.rest.name);
  }
  return "{" + ctx.sp + props.join("," + ctx.sp) + ctx.sp + "}";
}
function emitArrayPattern(pat, ctx) {
  const els = pat.elements.map((e) => {
    if (e === null) {
      return "";
    }
    if (e.type === "Identifier") {
      return e.name;
    }
    return emitPattern(e, ctx);
  });
  if (pat.rest) {
    els.push("..." + pat.rest.name);
  }
  return "[" + els.join("," + ctx.sp) + "]";
}
function emitExpression(expr, ctx) {
  switch (expr.type) {
    case "Identifier": {
      return expr.name;
    }
    case "Literal": {
      return emitLiteral(expr);
    }
    case "CallExpression": {
      return emitCall(expr, ctx);
    }
    case "BinaryExpression": {
      return emitBinary(expr, ctx);
    }
    case "UnaryExpression": {
      return expr.operator + emitExpression(expr.argument, ctx);
    }
    case "UpdateExpression": {
      if (expr.prefix) {
        return expr.operator + emitExpression(expr.argument, ctx);
      }
      return emitExpression(expr.argument, ctx) + expr.operator;
    }
    case "TemplateLiteral": {
      return emitTemplate(expr, ctx);
    }
    case "MemberExpression": {
      return emitMember(expr, ctx);
    }
    case "ArrayExpression": {
      return emitArray(expr, ctx);
    }
    case "ObjectExpression": {
      return emitObject(expr, ctx);
    }
    case "ArrowFunction": {
      return emitArrow(expr, ctx);
    }
    case "AssignmentExpression": {
      return emitExpression(expr.left, ctx) + ctx.sp + "=" + ctx.sp + emitExpression(expr.right, ctx);
    }
    case "CompoundAssignmentExpression": {
      return emitExpression(expr.left, ctx) + ctx.sp + expr.operator + ctx.sp + emitExpression(expr.right, ctx);
    }
    case "NewExpression": {
      return emitNew(expr, ctx);
    }
    case "AwaitExpression": {
      return "await " + emitExpression(expr.argument, ctx);
    }
    case "SpreadExpression": {
      return "..." + emitExpression(expr.argument, ctx);
    }
    case "TernaryExpression": {
      return emitExpression(expr.condition, ctx) + ctx.sp + "?" + ctx.sp + emitExpression(expr.consequent, ctx) + ctx.sp + ":" + ctx.sp + emitExpression(expr.alternate, ctx);
    }
    case "TypeofExpression": {
      return "typeof " + emitExpression(expr.argument, ctx);
    }
    case "VoidExpression": {
      return "void " + emitExpression(expr.argument, ctx);
    }
    case "DeleteExpression": {
      return "delete " + emitExpression(expr.argument, ctx);
    }
    case "YieldExpression": {
      const delegate = expr.delegate ? "*" : "";
      if (!expr.argument) {
        return "yield" + delegate;
      }
      return "yield" + delegate + " " + emitExpression(expr.argument, ctx);
    }
    case "ObjectPattern": {
      return emitObjectPattern(expr, ctx);
    }
    case "ArrayPattern": {
      return emitArrayPattern(expr, ctx);
    }
    case "RegExpLiteral": {
      return expr.flags ? "/" + expr.pattern + "/" + expr.flags : "/" + expr.pattern + "/";
    }
    case "AsExpression": {
      return emitExpression(expr.expression, ctx);
    }
    case "ComptimeExpression": {
      let code2 = "";
      if (expr.body) {
        const stmts = expr.body.map((s) => emitStatement(s, ctx));
        if (stmts.length > 0) {
          const init = stmts.slice(0, -1).join("\n");
          const last = stmts[stmts.length - 1].trim().replace(/;$/, "");
          code2 = init + init ? "\n" : "return " + last + ";";
        } else {
          code2 = "return undefined;";
        }
        const evaluator = new Function(code2);
        const result = evaluator();
        return comptimeSerialize(result);
      } else {
        code2 = emitExpression(expr.expression, ctx);
        const evaluator2 = new Function("return (" + code2 + ")");
        const result = evaluator2();
        return comptimeSerialize(result);
      }
      break;
    }
    case "IfExpression": {
      const cond2 = emitExpression(expr.condition, ctx);
      const thenStmts = expr.consequent.map((s) => emitStatement(s, ctx));
      const elseStmts = expr.alternate.map((s) => emitStatement(s, ctx));
      const wrapReturn = (stmts) => {
        if (stmts.length === 0) {
          return ["return undefined;"];
        }
        const last = stmts[stmts.length - 1];
        const trimmed = last.trim();
        if (!trimmed.startsWith("return ") && !trimmed.startsWith("return;")) {
          stmts[stmts.length - 1] = "return " + trimmed;
        }
        return stmts;
      };
      const thenBody = wrapReturn([...thenStmts]).join("; ");
      const elseBody = wrapReturn([...elseStmts]).join("; ");
      return "(() =>" + ctx.sp + "{" + ctx.sp + "if" + ctx.sp + "(" + cond2 + ")" + ctx.sp + "{" + ctx.sp + thenBody + ctx.sp + "}" + ctx.sp + "else" + ctx.sp + "{" + ctx.sp + elseBody + ctx.sp + "}" + ctx.sp + "})()";
    }
    default: {
      throw new Error("Unsupported expression type: " + expr.type);
    }
  }
}
function emitLiteral(lit) {
  switch (lit.literalType) {
    case "number": {
      return String(lit.value);
    }
    case "string": {
      return JSON.stringify(lit.value);
    }
    case "boolean": {
      return String(lit.value);
    }
    case "null": {
      return "null";
    }
    case "undefined": {
      return "undefined";
    }
    default: {
      return String(lit.value);
    }
  }
}
function comptimeSerialize(result) {
  if (result === void 0) {
    return "undefined";
  }
  if (result === null) {
    return "null";
  }
  if (typeof result === "string") {
    return JSON.stringify(result);
  }
  if (typeof result === "number" || typeof result === "boolean") {
    return String(result);
  }
  if (Array.isArray(result)) {
    return JSON.stringify(result);
  }
  if (typeof result === "object") {
    return JSON.stringify(result);
  }
  return String(result);
}
function emitCall(call, ctx) {
  let callee = "";
  if (call.callee.type === "Identifier" && call.callee.name === "print") {
    callee = "console.log";
  } else {
    callee = emitExpression(call.callee, ctx);
  }
  const allArgs = call.arguments.map((a) => emitExpression(a, ctx));
  if (call.namedArgs && call.namedArgs.length > 0) {
    const props = call.namedArgs.map((na) => na.name.name + ":" + ctx.sp + emitExpression(na.value, ctx)).join("," + ctx.sp);
    allArgs.push(`{` + props + "}");
  }
  const argsStr = allArgs.join("," + ctx.sp);
  if (call.optional) {
    return callee + "?.(" + argsStr + ")";
  }
  return callee + "(" + argsStr + ")";
}
function emitBinary(bin, ctx) {
  if (bin.operator === "|>") {
    const arg = emitExpression(bin.left, ctx);
    const f = emitExpression(bin.right, ctx);
    return f + "(" + arg + ")";
  }
  if (bin.operator === "*") {
    const isLeftString = bin.left.type === "Literal" && bin.left.literalType === "string" || bin.left.type === "TemplateLiteral";
    const isRightString = bin.right.type === "Literal" && bin.right.literalType === "string" || bin.right.type === "TemplateLiteral";
    if (isLeftString) {
      return emitExpression(bin.left, ctx) + ".repeat(" + emitExpression(bin.right, ctx) + ")";
    }
    if (isRightString) {
      return emitExpression(bin.right, ctx) + ".repeat(" + emitExpression(bin.left, ctx) + ")";
    }
  }
  if (bin.operator === "..") {
    throw new Error("Range operator '..' can only be used inside 'for' loops (e.g., for i in 0..10)");
  }
  let op = bin.operator;
  if (op === "==") {
    op = "===";
  }
  if (op === "!=") {
    op = "!==";
  }
  const left = parenthesizeIfNeeded(bin.left, bin.operator, ctx);
  const right = parenthesizeIfNeeded(bin.right, bin.operator, ctx);
  return left + ctx.sp + op + ctx.sp + right;
}
function parenthesizeIfNeeded(expr, parentOp, ctx) {
  if (expr.type !== "BinaryExpression") {
    return emitExpression(expr, ctx);
  }
  const parentPrec = PRECEDENCE[parentOp] ?? 0;
  const childPrec = PRECEDENCE[expr.operator] ?? 0;
  const inner = emitBinary(expr, ctx);
  return childPrec < parentPrec ? "(" + inner + ")" : inner;
}
function emitTemplate(t, ctx) {
  const body = t.parts.map((p) => {
    if (p.kind === "Text") {
      return p.value.replace(/`/g, "\\`").replace(/\$/g, "\\$");
    }
    return "${" + emitExpression(p.expression, ctx) + "}";
  }).join("");
  return "`" + body + "`";
}
function emitMember(m, ctx) {
  const obj = emitExpression(m.object, ctx);
  if (m.computed) {
    if (m.property.type === "BinaryExpression" && m.property.operator === "..") {
      const start = emitExpression(m.property.left, ctx);
      const end = emitExpression(m.property.right, ctx);
      const dot2 = m.optional ? "?." : ".";
      return obj + dot2 + "slice(" + start + "," + ctx.sp + end + ")";
    }
    const bracket = m.optional ? "?.[" : "[";
    return obj + bracket + emitExpression(m.property, ctx) + "]";
  }
  const dot = m.optional ? "?." : ".";
  return obj + dot + emitExpression(m.property, ctx);
}
function emitArray(arr, ctx) {
  const els = arr.elements.map((e) => emitExpression(e, ctx)).join("," + ctx.sp);
  return "[" + els + "]";
}
function emitObject(obj, ctx) {
  if (obj.properties.length === 0) {
    return "{}";
  }
  const props = obj.properties.map((p) => {
    if (p.shorthand) {
      return p.key.name;
    }
    let keyStr = "";
    if (p.computed) {
      keyStr = "[" + emitExpression(p.key, ctx) + "]";
    } else if (p.key.type === "Identifier") {
      keyStr = p.key.name;
    } else {
      keyStr = JSON.stringify(p.key.value);
    }
    return keyStr + ":" + ctx.sp + emitExpression(p.value, ctx);
  }).join("," + ctx.sp);
  return "{" + ctx.sp + props + ctx.sp + "}";
}
function emitArrow(f, ctx) {
  const asyncPrefix = f.async ? "async " : "";
  const params = f.params.map((p) => emitParam(p, ctx)).join("," + ctx.sp);
  const paramStr = f.params.length === 1 && !f.params[0].rest && !f.params[0].defaultValue ? f.params[0].name : "(" + params + ")";
  if (Array.isArray(f.body)) {
    const inner = indented(ctx);
    const body = f.body.map((s) => pad(inner) + emitStatement(s, inner)).join(ctx.nl);
    return asyncPrefix + paramStr + ctx.sp + "=>" + ctx.sp + "{" + ctx.nl + body + ctx.nl + pad(ctx) + "}";
  }
  return asyncPrefix + paramStr + ctx.sp + "=>" + ctx.sp + emitExpression(f.body, ctx);
}
function emitNew(n, ctx) {
  const callee = emitExpression(n.callee, ctx);
  const args = n.arguments.map((a) => emitExpression(a, ctx)).join("," + ctx.sp);
  return "new " + callee + "(" + args + ")";
}
var init_js_generator = __esm({
  "dist/compiler/generator/js-generator.js"() {
    init_precedence();
    init_resolver();
    init_source_map();
  }
});

// dist/compiler/type-checker.js
function annotationToType(ann) {
  if (!ann) {
    return ANY;
  }
  switch (ann.kind) {
    case "named": {
      const n = ann.name;
      if (n === "string") {
        return STRING;
      }
      if (n === "number") {
        return NUMBER;
      }
      if (n === "boolean") {
        return BOOLEAN;
      }
      if (n === "void") {
        return VOID;
      }
      if (n === "null") {
        return NULL_TYPE;
      }
      if (n === "undefined") {
        return UNDEFINED;
      }
      if (n === "any") {
        return ANY;
      }
      if (n === "never") {
        return { kind: "never" };
      }
      return { kind: "named", name: n };
    }
    case "array": {
      return { kind: "array", element: annotationToType(ann.elementType) };
    }
    case "union": {
      return { kind: "union", types: ann.types.map(annotationToType) };
    }
    case "intersection": {
      return { kind: "intersection", types: ann.types.map(annotationToType) };
    }
    case "generic": {
      return { kind: "generic", base: ann.name, args: ann.args.map(annotationToType) };
    }
    case "function": {
      return { kind: "function", params: ann.params.map(annotationToType), returnType: annotationToType(ann.returnType) };
    }
    case "tuple": {
      return { kind: "tuple", elements: ann.elements.map(annotationToType) };
    }
    case "object": {
      const props = /* @__PURE__ */ new Map();
      for (const p of ann.properties) {
        props.set(p.key, annotationToType(p.value));
      }
      return { kind: "object", properties: props };
    }
    case "literal": {
      if (typeof ann.value === "string") {
        return STRING;
      }
      if (typeof ann.value === "number") {
        return NUMBER;
      }
      if (typeof ann.value === "boolean") {
        return BOOLEAN;
      }
      return ANY;
    }
    case "nullable": {
      return { kind: "union", types: [annotationToType(ann.inner), NULL_TYPE, UNDEFINED] };
    }
    default: {
      return ANY;
    }
  }
}
function typeToString(t) {
  switch (t.kind) {
    case "primitive": {
      return t.name;
    }
    case "any": {
      return "any";
    }
    case "never": {
      return "never";
    }
    case "array": {
      return typeToString(t.element) + "[]";
    }
    case "tuple": {
      return "[" + t.elements.map(typeToString).join(", ") + "]";
    }
    case "union": {
      return t.types.map(typeToString).join(" | ");
    }
    case "intersection": {
      return t.types.map(typeToString).join(" & ");
    }
    case "function": {
      return "(" + t.params.map(typeToString).join(", ") + ") => " + typeToString(t.returnType);
    }
    case "named": {
      return t.name;
    }
    case "generic": {
      return t.base + "<" + t.args.map(typeToString).join(", ") + ">";
    }
    case "typeParam": {
      if (t.constraint) {
        return t.name + " extends " + typeToString(t.constraint);
      }
      return t.name;
    }
    case "object": {
      const entries = Array.from(t.properties).map((entry) => entry[0] + ": " + typeToString(entry[1]));
      return "{ " + entries.join("; ") + " }";
    }
    default: {
      return "unknown";
    }
  }
}
function isAssignableTo(source, target) {
  if (target.kind === "any" || source.kind === "any") {
    return true;
  }
  if (source.kind === "never") {
    return true;
  }
  if (source.kind === "primitive" && target.kind === "primitive") {
    return source.name === target.name;
  }
  if (source.kind === "primitive" && (source.name === "null" || source.name === "undefined")) {
    return true;
  }
  if (source.kind === "named" && target.kind === "named") {
    return source.name === target.name;
  }
  if (source.kind === "array" && target.kind === "array") {
    return isAssignableTo(source.element, target.element);
  }
  if (target.kind === "union") {
    return target.types.some((t) => isAssignableTo(source, t));
  }
  if (source.kind === "union") {
    return source.types.every((t) => isAssignableTo(t, target));
  }
  if (target.kind === "intersection") {
    return target.types.every((t) => isAssignableTo(source, t));
  }
  if (source.kind === "function" && target.kind === "function") {
    if (source.params.length !== target.params.length) {
      return false;
    }
    let i = 0;
    while (i < source.params.length) {
      const ok = isAssignableTo(target.params[i], source.params[i]);
      if (!ok) {
        return false;
      }
      i = i + 1;
    }
    return isAssignableTo(source.returnType, target.returnType);
  }
  if (source.kind === "typeParam") {
    if (target.kind === "typeParam" && source.name === target.name) {
      return true;
    }
    if (source.constraint) {
      return isAssignableTo(source.constraint, target);
    }
    return true;
  }
  if (target.kind === "typeParam") {
    if (target.constraint) {
      return isAssignableTo(source, target.constraint);
    }
    return true;
  }
  if (source.kind === "generic" && target.kind === "generic") {
    if (source.base !== target.base) {
      return false;
    }
    if (source.args.length !== target.args.length) {
      return false;
    }
    return source.args.every((arg, i) => isAssignableTo(arg, target.args[i]));
  }
  return false;
}
function inferExpression(expr, env) {
  switch (expr.type) {
    case "Literal": {
      switch (expr.literalType) {
        case "string": {
          return STRING;
        }
        case "number": {
          return NUMBER;
        }
        case "boolean": {
          return BOOLEAN;
        }
        case "null": {
          return NULL_TYPE;
        }
        default: {
          return ANY;
        }
      }
      break;
    }
    case "Identifier": {
      return env.lookup(expr.name) ?? ANY;
    }
    case "ArrayExpression": {
      if (expr.elements.length === 0) {
        return { kind: "array", element: ANY };
      }
      return { kind: "array", element: inferExpression(expr.elements[0], env) };
    }
    case "ObjectExpression": {
      const props = /* @__PURE__ */ new Map();
      for (const prop of expr.properties) {
        const key = prop.key.type === "Identifier" ? prop.key.name : String(prop.key.value);
        props.set(key, inferExpression(prop.value, env));
      }
      return { kind: "object", properties: props };
    }
    case "BinaryExpression": {
      if (["+", "-", "*", "/", "%", "**"].includes(expr.operator)) {
        const lt = inferExpression(expr.left, env);
        const rt = inferExpression(expr.right, env);
        if (expr.operator === "+" && (lt.kind === "primitive" && lt.name === "string" || rt.kind === "primitive" && rt.name === "string")) {
          return STRING;
        }
        return NUMBER;
      }
      if (["==", "!=", "===", "!==", "<", ">", "<=", ">=", "instanceof"].includes(expr.operator)) {
        return BOOLEAN;
      }
      if (["&&", "||", "??"].includes(expr.operator)) {
        return inferExpression(expr.right, env);
      }
      return ANY;
    }
    case "UnaryExpression": {
      if (expr.operator === "!") {
        return BOOLEAN;
      }
      if (expr.operator === "typeof") {
        return STRING;
      }
      if (expr.operator === "-" || expr.operator === "+" || expr.operator === "~") {
        return NUMBER;
      }
      return ANY;
    }
    case "TemplateLiteral": {
      return STRING;
    }
    case "CallExpression": {
      if (expr.callee.type === "Identifier") {
        const fnType = env.lookup(expr.callee.name);
        if (fnType && fnType.kind === "function") {
          return fnType.returnType;
        }
      }
      return ANY;
    }
    case "ArrowFunction": {
      return { kind: "function", params: expr.params.map((p) => annotationToType(p.typeAnnotation)), returnType: annotationToType(expr.returnType) };
    }
    case "TernaryExpression": {
      return inferExpression(expr.consequent, env);
    }
    case "AsExpression": {
      return annotationToType(expr.typeAnnotation);
    }
    case "AwaitExpression": {
      return inferExpression(expr.argument, env);
    }
    case "IfExpression": {
      if (expr.consequent.length > 0) {
        const last = expr.consequent[expr.consequent.length - 1];
        if (last.expression) {
          return inferExpression(last.expression, env);
        }
        if (last.value) {
          return inferExpression(last.value, env);
        }
        return inferExpression(last, env);
      }
      return ANY;
    }
    case "NewExpression": {
      if (expr.callee.type === "Identifier") {
        return { kind: "named", name: expr.callee.name };
      }
      return ANY;
    }
    default: {
      return ANY;
    }
  }
}
function getLine(stmt) {
  return stmt?.loc?.line ? stmt.loc.line - 1 : 0;
}
function getCol(stmt) {
  return stmt?.loc?.column ? stmt.loc.column - 1 : 0;
}
function extractTypeGuard(cond2) {
  if (cond2.type !== "BinaryExpression") {
    return null;
  }
  if (cond2.operator !== "===" && cond2.operator !== "==") {
    return null;
  }
  if (cond2.left.type === "UnaryExpression" && cond2.left.operator === "typeof" && cond2.left.argument.type === "Identifier" && cond2.right.type === "Literal" && typeof cond2.right.value === "string") {
    const mapped = TYPEOF_MAP[cond2.right.value];
    if (mapped) {
      return { name: cond2.left.argument.name, narrowedType: mapped };
    }
  }
  if (cond2.right.type === "UnaryExpression" && cond2.right.operator === "typeof" && cond2.right.argument.type === "Identifier" && cond2.left.type === "Literal" && typeof cond2.left.value === "string") {
    const mapped = TYPEOF_MAP[cond2.left.value];
    if (mapped) {
      return { name: cond2.right.argument.name, narrowedType: mapped };
    }
  }
  return null;
}
function checkStatements(stmts, env, diags) {
  for (const stmt of stmts) {
    checkStatement(stmt, env, diags);
  }
}
function checkStatement(stmt, env, diags) {
  switch (stmt.type) {
    case "VariableDeclaration": {
      const declaredType = annotationToType(stmt.typeAnnotation);
      const initType = inferExpression(stmt.value, env);
      if (declaredType.kind !== "any" && initType.kind !== "any") {
        const assignable = isAssignableTo(initType, declaredType);
        if (!assignable) {
          diags.push({ line: getLine(stmt), column: getCol(stmt), message: "Type '" + typeToString(initType) + "' is not assignable to type '" + typeToString(declaredType) + "'", severity: "error" });
        }
      }
      const resolvedType = declaredType.kind !== "any" ? declaredType : initType;
      if (stmt.name) {
        env.define(stmt.name.name, resolvedType);
      }
      break;
    }
    case "FunctionDeclaration": {
      env.push();
      const tpNames = stmt.typeParams || [];
      for (const tp of tpNames) {
        env.defineTypeParam(tp);
      }
      const paramTypes = stmt.params.map((p) => {
        const ann = annotationToType(p.typeAnnotation);
        if (ann.kind === "named" && tpNames.includes(ann.name)) {
          return env.lookupTypeParam(ann.name) ?? ann;
        }
        return ann;
      });
      const retAnn = annotationToType(stmt.returnType);
      let retType = retAnn;
      if (retAnn.kind === "named" && tpNames.includes(retAnn.name)) {
        retType = env.lookupTypeParam(retAnn.name) ?? retAnn;
      }
      const fnType = { kind: "function", params: paramTypes, returnType: retType, typeParams: tpNames.length > 0 ? tpNames : void 0 };
      env.pop();
      env.define(stmt.name.name, fnType);
      env.push();
      for (const tp of tpNames) {
        env.defineTypeParam(tp);
      }
      let pi = 0;
      while (pi < stmt.params.length) {
        env.define(stmt.params[pi].name, paramTypes[pi]);
        pi = pi + 1;
      }
      checkStatements(stmt.body, env, diags);
      if (retType.kind !== "any" && retType.kind !== "typeParam") {
        checkReturnTypes(stmt.body, retType, env, diags);
      }
      env.pop();
      break;
    }
    case "ClassDeclaration": {
      env.define(stmt.name.name, { kind: "named", name: stmt.name.name });
      if (stmt.implements && stmt.implements.length > 0) {
        checkImplements(stmt, env, diags);
      }
      break;
    }
    case "ExpressionStatement": {
      inferExpression(stmt.expression, env);
      break;
    }
    case "IfStatement": {
      inferExpression(stmt.condition, env);
      env.push();
      const guard = extractTypeGuard(stmt.condition);
      if (guard) {
        env.define(guard.name, guard.narrowedType);
      }
      checkStatements(stmt.consequent, env, diags);
      env.pop();
      if (stmt.alternate) {
        env.push();
        checkStatements(stmt.alternate, env, diags);
        env.pop();
      }
      break;
    }
    case "ReturnStatement": {
      if (stmt.value) {
        inferExpression(stmt.value, env);
      }
      break;
    }
    case "ForStatement": {
      env.push();
      if (stmt.variable.type === "Identifier") {
        env.define(stmt.variable.name, ANY);
      }
      checkStatements(stmt.body, env, diags);
      env.pop();
      break;
    }
    case "WhileStatement": {
      inferExpression(stmt.condition, env);
      env.push();
      checkStatements(stmt.body, env, diags);
      env.pop();
      break;
    }
    case "DoWhileStatement": {
      inferExpression(stmt.condition, env);
      env.push();
      checkStatements(stmt.body, env, diags);
      env.pop();
      break;
    }
    case "ImportDeclaration": {
      if (stmt.defaultImport) {
        env.define(stmt.defaultImport, ANY);
      }
      for (const spec of stmt.namedImports) {
        env.define(spec.alias ?? spec.name, ANY);
      }
      break;
    }
    case "ExportDeclaration": {
      if (stmt.declaration) {
        checkStatement(stmt.declaration, env, diags);
      }
      break;
    }
    case "TryCatchStatement": {
      env.push();
      checkStatements(stmt.tryBlock, env, diags);
      env.pop();
      if (stmt.catchBlock.length > 0) {
        env.push();
        if (stmt.catchParam) {
          env.define(stmt.catchParam.name, ANY);
        }
        checkStatements(stmt.catchBlock, env, diags);
        env.pop();
      }
      if (stmt.finallyBlock) {
        env.push();
        checkStatements(stmt.finallyBlock, env, diags);
        env.pop();
      }
      break;
    }
    case "EnumDeclaration": {
      env.define(stmt.name.name, { kind: "named", name: stmt.name.name });
      break;
    }
    case "InterfaceDeclaration": {
      env.define(stmt.name.name, { kind: "named", name: stmt.name.name });
      const members = /* @__PURE__ */ new Map();
      for (const prop of stmt.properties) {
        let propType = annotationToType(prop.valueType);
        if (prop.method) {
          const mParams = prop.params || [].map(annotationToType);
          propType = { kind: "function", params: mParams, returnType: annotationToType(prop.valueType) };
        }
        members.set(prop.name.name, { type: propType, optional: prop.optional, method: prop.method });
      }
      const extendNames = stmt.extends || [].map((id) => id.name);
      env.interfaces.set(stmt.name.name, { name: stmt.name.name, members, extends: extendNames });
      break;
    }
  }
}
function collectInterfaceMembers(ifaceName, env) {
  const iface = env.interfaces.get(ifaceName);
  if (!iface) {
    return /* @__PURE__ */ new Map();
  }
  const all = /* @__PURE__ */ new Map();
  for (const parent of iface.extends) {
    const parentMembers = collectInterfaceMembers(parent, env);
    for (const entry of Array.from(parentMembers)) {
      all.set(entry[0], entry[1]);
    }
  }
  for (const entry of Array.from(iface.members)) {
    all.set(entry[0], entry[1]);
  }
  return all;
}
function checkImplements(cls, env, diags) {
  if (!cls.implements) {
    return;
  }
  for (const ifaceId of cls.implements) {
    const ifaceDef = env.interfaces.get(ifaceId.name);
    if (!ifaceDef) {
      diags.push({ line: getLine(cls), column: getCol(cls), message: "Interface '" + ifaceId.name + "' is not defined", severity: "error" });
      continue;
    }
    const required = collectInterfaceMembers(ifaceId.name, env);
    const classMembers = /* @__PURE__ */ new Map();
    for (const member of cls.body) {
      if (member.type === "ClassMethod") {
        const mName = member.name.name || member.name.value;
        if (mName && member.kind !== "constructor") {
          classMembers.set(mName, { isMethod: true });
        }
      } else if (member.type === "ClassField") {
        const fName = member.name.name || member.name.value;
        if (fName) {
          classMembers.set(fName, { isMethod: false });
        }
      }
    }
    for (const entry of Array.from(required)) {
      const memberName = entry[0];
      const memberDef = entry[1];
      if (memberDef.optional) {
        continue;
      }
      const classMember = classMembers.get(memberName);
      if (!classMember) {
        const memberKind = memberDef.method ? "method" : "property";
        diags.push({ line: getLine(cls), column: getCol(cls), message: "Class '" + cls.name.name + "' is missing required " + memberKind + " '" + memberName + "' from interface '" + ifaceId.name + "'", severity: "error" });
      }
    }
  }
}
function checkReturnTypes(body, expected, env, diags) {
  for (const stmt of body) {
    if (stmt.type === "ReturnStatement" && stmt.value) {
      const actual = inferExpression(stmt.value, env);
      const assignOk = isAssignableTo(actual, expected);
      if (actual.kind !== "any" && !assignOk) {
        diags.push({ line: getLine(stmt), column: getCol(stmt), message: "Type '" + typeToString(actual) + "' is not assignable to return type '" + typeToString(expected) + "'", severity: "error" });
      }
    }
    if (stmt.type === "IfStatement") {
      checkReturnTypes(stmt.consequent, expected, env, diags);
      if (stmt.alternate) {
        checkReturnTypes(stmt.alternate, expected, env, diags);
      }
    }
  }
}
function typeCheck(ast) {
  const diags = [];
  const env = new TypeEnv();
  checkStatements(ast.body, env, diags);
  return diags;
}
var ANY, VOID, STRING, NUMBER, BOOLEAN, NULL_TYPE, UNDEFINED, TypeEnv, TYPEOF_MAP;
var init_type_checker = __esm({
  "dist/compiler/type-checker.js"() {
    ANY = { kind: "any" };
    VOID = { kind: "primitive", name: "void" };
    STRING = { kind: "primitive", name: "string" };
    NUMBER = { kind: "primitive", name: "number" };
    BOOLEAN = { kind: "primitive", name: "boolean" };
    NULL_TYPE = { kind: "primitive", name: "null" };
    UNDEFINED = { kind: "primitive", name: "undefined" };
    TypeEnv = class {
      constructor() {
        this.scopes = [{ bindings: /* @__PURE__ */ new Map(), typeParams: /* @__PURE__ */ new Map() }];
        this.interfaces = /* @__PURE__ */ new Map();
      }
      push() {
        return this.scopes.push({ bindings: /* @__PURE__ */ new Map(), typeParams: /* @__PURE__ */ new Map() });
      }
      pop() {
        return this.scopes.pop();
      }
      define(name, type) {
        return this.scopes[this.scopes.length - 1].bindings.set(name, type);
      }
      defineTypeParam(name, constraint) {
        const tp = { kind: "typeParam", name, constraint };
        this.scopes[this.scopes.length - 1].typeParams.set(name, tp);
        this.scopes[this.scopes.length - 1].bindings.set(name, tp);
      }
      lookupTypeParam(name) {
        let i = this.scopes.length - 1;
        while (i >= 0) {
          const t = this.scopes[i].typeParams.get(name);
          if (t) {
            return t;
          }
          i = i - 1;
        }
        return null;
      }
      lookup(name) {
        let i = this.scopes.length - 1;
        while (i >= 0) {
          const t = this.scopes[i].bindings.get(name);
          if (t) {
            return t;
          }
          i = i - 1;
        }
        return null;
      }
    };
    TYPEOF_MAP = { "string": STRING, "number": NUMBER, "boolean": BOOLEAN, "undefined": UNDEFINED, "object": { kind: "named", name: "object" }, "function": { kind: "function", params: [], returnType: ANY } };
  }
});

// dist/compiler/formatter/formatter.js
var formatter_exports = {};
__export(formatter_exports, {
  format: () => format
});
function format(program, opts) {
  const options = { indentSize: opts?.indentSize ?? 2, maxLineWidth: opts?.maxLineWidth ?? 100 };
  const ctx = { indent: 0, options };
  const lines = program.body.map((stmt) => fmtStatement(stmt, ctx));
  return lines.join("\n") + "\n";
}
function pad2(ctx) {
  return " ".repeat(ctx.indent * ctx.options.indentSize);
}
function indented2(ctx) {
  return { indent: ctx.indent + 1, options: ctx.options };
}
function fmtStatement(stmt, ctx) {
  switch (stmt.type) {
    case "FunctionDeclaration": {
      return fmtFunction(stmt, ctx);
    }
    case "VariableDeclaration": {
      return fmtVariable(stmt, ctx);
    }
    case "DestructuringDeclaration": {
      return fmtDestructuring(stmt, ctx);
    }
    case "ExpressionStatement": {
      return pad2(ctx) + fmtExpression(stmt.expression, ctx);
    }
    case "IfStatement": {
      return fmtIf(stmt, ctx);
    }
    case "ForStatement": {
      return fmtFor(stmt, ctx);
    }
    case "WhileStatement": {
      return fmtWhile(stmt, ctx);
    }
    case "DoWhileStatement": {
      return fmtDoWhile(stmt, ctx);
    }
    case "ReturnStatement": {
      return fmtReturn(stmt, ctx);
    }
    case "ImportDeclaration": {
      return fmtImport(stmt, ctx);
    }
    case "ExportDeclaration": {
      return fmtExport(stmt, ctx);
    }
    case "ClassDeclaration": {
      return fmtClass(stmt, ctx);
    }
    case "TryCatchStatement": {
      return fmtTryCatch(stmt, ctx);
    }
    case "ThrowStatement": {
      return pad2(ctx) + "throw " + fmtExpression(stmt.value, ctx);
    }
    case "SwitchStatement": {
      return fmtSwitch(stmt, ctx);
    }
    case "MatchStatement": {
      return fmtMatch(stmt, ctx);
    }
    case "EnumDeclaration": {
      return fmtEnum(stmt, ctx);
    }
    case "InterfaceDeclaration": {
      return fmtInterface(stmt, ctx);
    }
    case "TypeAliasDeclaration": {
      return fmtTypeAlias(stmt, ctx);
    }
    case "ADTDeclaration": {
      return fmtADT(stmt, ctx);
    }
    case "GoStatement": {
      return fmtGo(stmt, ctx);
    }
    case "BreakStatement": {
      return pad2(ctx) + "break" + stmt.label ? " " + stmt.label : "";
    }
    case "ContinueStatement": {
      return pad2(ctx) + "continue" + stmt.label ? " " + stmt.label : "";
    }
    case "DebuggerStatement": {
      return pad2(ctx) + "debugger";
    }
    case "LabeledStatement": {
      return pad2(ctx) + stmt.label + ":\n" + fmtStatement(stmt.body, ctx);
    }
    default: {
      return pad2(ctx) + "/* unsupported: " + stmt.type + " */";
    }
  }
}
function fmtFunction(f, ctx) {
  const inner = indented2(ctx);
  const prefix = f.async ? "async " : "";
  const gen = f.generator ? "*" : "";
  const typeParams = f.typeParams ? "<" + f.typeParams.join(", ") + ">" : "";
  const params = f.params.map((p) => fmtParam(p)).join(", ");
  const ret = f.returnType ? ": " + fmtType(f.returnType) : "";
  const body = f.body.map((s) => fmtStatement(s, inner)).join("\n");
  let decs = "";
  if (f.decorators && f.decorators.length > 0) {
    decs = f.decorators.map((d) => {
      const args = d.arguments ? "(" + d.arguments.map((a) => fmtExpression(a, ctx)).join(", ") + ")" : "";
      return pad2(ctx) + "@" + d.name + args;
    }).join("\n") + "\n";
  }
  return decs + pad2(ctx) + prefix + "fn" + gen + " " + f.name.name + typeParams + "(" + params + ")" + ret + ` {
` + body + "\n" + pad2(ctx) + "}";
}
function fmtParam(p) {
  let out = "";
  if (p.rest) {
    out = out + "...";
  }
  if (p.pattern) {
    out = out + fmtPattern(p.pattern);
  } else {
    out = out + p.name;
  }
  if (p.typeAnnotation) {
    out = out + ": " + fmtType(p.typeAnnotation);
  }
  if (p.defaultValue) {
    out = out + " = " + fmtExpression(p.defaultValue, { indent: 0, options: { indentSize: 2, maxLineWidth: 100 } });
  }
  return out;
}
function fmtVariable(v, ctx) {
  const typeStr = v.typeAnnotation ? ": " + fmtType(v.typeAnnotation) : "";
  return pad2(ctx) + v.kind + " " + v.name.name + typeStr + " = " + fmtExpression(v.value, ctx);
}
function fmtDestructuring(d, ctx) {
  const pat = fmtPattern(d.pattern);
  return pad2(ctx) + d.kind + " " + pat + " = " + fmtExpression(d.value, ctx);
}
function fmtIf(stmt, ctx) {
  const inner = indented2(ctx);
  const cond2 = fmtExpression(stmt.condition, ctx);
  const body = stmt.consequent.map((s) => fmtStatement(s, inner)).join("\n");
  let out = pad2(ctx) + "if " + cond2 + ` {
` + body + "\n" + pad2(ctx) + "}";
  if (stmt.alternate && stmt.alternate.length > 0) {
    if (stmt.alternate.length === 1 && stmt.alternate[0].type === "IfStatement") {
      const elseIf = fmtIf(stmt.alternate[0], ctx);
      out = out + " else " + elseIf.trimStart();
    } else {
      const alt = stmt.alternate.map((s) => fmtStatement(s, inner)).join("\n");
      out = out + ` else {
` + alt + "\n" + pad2(ctx) + "}";
    }
  }
  return out;
}
function fmtFor(stmt, ctx) {
  const inner = indented2(ctx);
  let variable = "";
  if (stmt.variable.type === "Identifier") {
    variable = stmt.variable.name;
  } else {
    variable = fmtPattern(stmt.variable);
  }
  let iterable = "";
  if (stmt.iterable.type === "BinaryExpression" && stmt.iterable.operator === "..") {
    iterable = fmtExpression(stmt.iterable.left, ctx) + ".." + fmtExpression(stmt.iterable.right, ctx);
  } else {
    iterable = fmtExpression(stmt.iterable, ctx);
  }
  const body = stmt.body.map((s) => fmtStatement(s, inner)).join("\n");
  return pad2(ctx) + "for " + variable + " " + stmt.kind + " " + iterable + ` {
` + body + "\n" + pad2(ctx) + "}";
}
function fmtWhile(stmt, ctx) {
  const inner = indented2(ctx);
  const body = stmt.body.map((s) => fmtStatement(s, inner)).join("\n");
  return pad2(ctx) + "while " + fmtExpression(stmt.condition, ctx) + ` {
` + body + "\n" + pad2(ctx) + "}";
}
function fmtDoWhile(stmt, ctx) {
  const inner = indented2(ctx);
  const body = stmt.body.map((s) => fmtStatement(s, inner)).join("\n");
  return pad2(ctx) + `do {
` + body + "\n" + pad2(ctx) + "} while " + fmtExpression(stmt.condition, ctx);
}
function fmtReturn(stmt, ctx) {
  if (!stmt.value) {
    return pad2(ctx) + "return";
  }
  return pad2(ctx) + "return " + fmtExpression(stmt.value, ctx);
}
function fmtImport(stmt, ctx) {
  const src = "'" + stmt.source + "'";
  if (stmt.namedImports.length > 0) {
    const specs = stmt.namedImports.map((s) => s.alias ? s.name + " as " + s.alias : s.name).join(", ");
    return pad2(ctx) + "import { " + specs + " } from " + src;
  }
  if (stmt.namespaceImport) {
    return pad2(ctx) + "import * as " + stmt.namespaceImport + " from " + src;
  }
  return pad2(ctx) + "import " + stmt.defaultImport + " from " + src;
}
function fmtExport(stmt, ctx) {
  if (stmt.exportAll) {
    const alias = stmt.exportAllAlias ? " as " + stmt.exportAllAlias : "";
    return pad2(ctx) + "export *" + alias + " from '" + stmt.source + "'";
  }
  if (stmt.namedExports && stmt.namedExports.length > 0) {
    const specs = stmt.namedExports.map((s) => s.alias ? s.name + " as " + s.alias : s.name).join(", ");
    const fromClause = stmt.source ? " from '" + stmt.source + "'" : "";
    return pad2(ctx) + "export { " + specs + " }" + fromClause;
  }
  const def = stmt.isDefault ? "default " : "";
  if (stmt.declaration) {
    return pad2(ctx) + "export " + def + fmtStatement(stmt.declaration, { indent: 0, options: ctx.options }).trimStart();
  }
  return pad2(ctx) + "export " + def;
}
function fmtClass(cls, ctx) {
  const inner = indented2(ctx);
  const typeParams = cls.typeParams ? "<" + cls.typeParams.join(", ") + ">" : "";
  const ext = cls.superClass ? " extends " + cls.superClass.name : "";
  const members = cls.body.map((m) => fmtClassMember(m, inner)).join("\n\n");
  let decs = "";
  if (cls.decorators && cls.decorators.length > 0) {
    decs = cls.decorators.map((d) => {
      const args = d.arguments ? "(" + d.arguments.map((a) => fmtExpression(a, ctx)).join(", ") + ")" : "";
      return pad2(ctx) + "@" + d.name + args;
    }).join("\n") + "\n";
  }
  return decs + pad2(ctx) + "class " + cls.name.name + typeParams + ext + ` {
` + members + "\n" + pad2(ctx) + "}";
}
function fmtClassMember(member, ctx) {
  if (member.type === "ClassField") {
    const s2 = member.static ? "static " : "";
    const key2 = member.computed ? "[" + fmtExpression(member.name, ctx) + "]" : member.name.name;
    if (member.value) {
      return pad2(ctx) + s2 + key2 + " = " + fmtExpression(member.value, ctx);
    }
    return pad2(ctx) + s2 + key2;
  }
  const inner = indented2(ctx);
  const s = member.static ? "static " : "";
  const a = member.async ? "async " : "";
  const gen = member.generator ? "*" : "";
  const key = member.computed ? "[" + fmtExpression(member.name, ctx) + "]" : member.name.name;
  const kindPrefix = member.kind === "get" ? "get " : member.kind === "set" ? "set " : "";
  const params = member.params.map((p) => fmtParam(p)).join(", ");
  const ret = member.returnType ? ": " + fmtType(member.returnType) : "";
  const body = member.body.map((st) => fmtStatement(st, inner)).join("\n");
  if (member.kind === "constructor") {
    return pad2(ctx) + "constructor(" + params + `) {
` + body + "\n" + pad2(ctx) + "}";
  }
  return pad2(ctx) + s + a + kindPrefix + "fn" + gen + " " + key + "(" + params + ")" + ret + ` {
` + body + "\n" + pad2(ctx) + "}";
}
function fmtTryCatch(stmt, ctx) {
  const inner = indented2(ctx);
  const tryBody = stmt.tryBlock.map((s) => fmtStatement(s, inner)).join("\n");
  const catchParam = stmt.catchParam ? " (" + stmt.catchParam.name + ")" : "";
  const catchBody = stmt.catchBlock.map((s) => fmtStatement(s, inner)).join("\n");
  let out = pad2(ctx) + `try {
` + tryBody + "\n" + pad2(ctx) + "} catch" + catchParam + ` {
` + catchBody + "\n" + pad2(ctx) + "}";
  if (stmt.finallyBlock) {
    const finallyBody = stmt.finallyBlock.map((s) => fmtStatement(s, inner)).join("\n");
    out = out + ` finally {
` + finallyBody + "\n" + pad2(ctx) + "}";
  }
  return out;
}
function fmtSwitch(stmt, ctx) {
  const inner = indented2(ctx);
  const cases = stmt.cases.map((c) => fmtSwitchCase(c, inner)).join("\n");
  return pad2(ctx) + "switch " + fmtExpression(stmt.discriminant, ctx) + ` {
` + cases + "\n" + pad2(ctx) + "}";
}
function fmtSwitchCase(c, ctx) {
  const inner = indented2(ctx);
  const header = c.test ? "case " + fmtExpression(c.test, ctx) : "default";
  const body = c.consequent.map((s) => fmtStatement(s, inner)).join("\n");
  return pad2(ctx) + header + ` {
` + body + "\n" + pad2(ctx) + "}";
}
function fmtMatch(stmt, ctx) {
  const inner = indented2(ctx);
  const cases = stmt.cases.map((c) => fmtMatchCase(c, inner)).join("\n");
  return pad2(ctx) + "match " + fmtExpression(stmt.discriminant, ctx) + ` {
` + cases + "\n" + pad2(ctx) + "}";
}
function fmtMatchCase(c, ctx) {
  const inner = indented2(ctx);
  const header = c.pattern ? "case " + fmtExpression(c.pattern, ctx) : "default";
  const guard = c.guard ? " if " + fmtExpression(c.guard, ctx) : "";
  const body = c.body.map((s) => fmtStatement(s, inner)).join("\n");
  return pad2(ctx) + header + guard + ` {
` + body + "\n" + pad2(ctx) + "}";
}
function fmtEnum(stmt, ctx) {
  const inner = indented2(ctx);
  const members = stmt.members.map((m) => {
    if (m.value) {
      return pad2(inner) + m.name.name + " = " + fmtExpression(m.value, inner);
    }
    return pad2(inner) + m.name.name;
  }).join("\n");
  return pad2(ctx) + "enum " + stmt.name.name + ` {
` + members + "\n" + pad2(ctx) + "}";
}
function fmtInterface(stmt, ctx) {
  const inner = indented2(ctx);
  const ext = stmt.extends ? " extends " + stmt.extends.map((e) => e.name).join(", ") : "";
  const props = stmt.properties.map((p) => {
    const opt = p.optional ? "?" : "";
    if (p.method) {
      const params = p.params ? p.params.map((t) => fmtType(t)).join(", ") : "";
      return pad2(inner) + p.name.name + opt + "(" + params + "): " + fmtType(p.valueType);
    }
    return pad2(inner) + p.name.name + opt + ": " + fmtType(p.valueType);
  }).join("\n");
  return pad2(ctx) + "interface " + stmt.name.name + ext + ` {
` + props + "\n" + pad2(ctx) + "}";
}
function fmtTypeAlias(stmt, ctx) {
  const typeParams = stmt.typeParams ? "<" + stmt.typeParams.join(", ") + ">" : "";
  return pad2(ctx) + "type " + stmt.name.name + typeParams + " = " + fmtType(stmt.value);
}
function fmtADT(stmt, ctx) {
  const typeParams = stmt.typeParams ? "<" + stmt.typeParams.join(", ") + ">" : "";
  const variants = stmt.variants.map((v) => {
    if (v.fields.length === 0) {
      return v.name.name;
    }
    const fields = v.fields.map((f) => {
      if (f.name) {
        return f.name.name + ": " + fmtType(f.typeAnnotation);
      }
      return fmtType(f.typeAnnotation);
    }).join(", ");
    return v.name.name + "(" + fields + ")";
  }).join(" | ");
  return pad2(ctx) + "type " + stmt.name.name + typeParams + " = " + variants;
}
function fmtGo(stmt, ctx) {
  if (stmt.body) {
    const inner = indented2(ctx);
    const body = stmt.body.map((s) => fmtStatement(s, inner)).join("\n");
    return pad2(ctx) + `go {
` + body + "\n" + pad2(ctx) + "}";
  }
  return pad2(ctx) + "go " + fmtExpression(stmt.expression, ctx);
}
function fmtExpression(expr, ctx) {
  switch (expr.type) {
    case "Identifier": {
      return expr.name;
    }
    case "Literal": {
      return fmtLiteral(expr);
    }
    case "CallExpression": {
      return fmtCall(expr, ctx);
    }
    case "BinaryExpression": {
      return fmtBinary(expr, ctx);
    }
    case "UnaryExpression": {
      return expr.operator + fmtExpression(expr.argument, ctx);
    }
    case "UpdateExpression": {
      if (expr.prefix) {
        return expr.operator + fmtExpression(expr.argument, ctx);
      }
      return fmtExpression(expr.argument, ctx) + expr.operator;
    }
    case "TemplateLiteral": {
      return fmtTemplate(expr, ctx);
    }
    case "MemberExpression": {
      return fmtMember(expr, ctx);
    }
    case "ArrayExpression": {
      return fmtArray(expr, ctx);
    }
    case "ObjectExpression": {
      return fmtObject(expr, ctx);
    }
    case "ArrowFunction": {
      return fmtArrow(expr, ctx);
    }
    case "AssignmentExpression": {
      return fmtExpression(expr.left, ctx) + " = " + fmtExpression(expr.right, ctx);
    }
    case "CompoundAssignmentExpression": {
      return fmtExpression(expr.left, ctx) + " " + expr.operator + " " + fmtExpression(expr.right, ctx);
    }
    case "NewExpression": {
      const args = expr.arguments.map((a) => fmtExpression(a, ctx)).join(", ");
      return "new " + fmtExpression(expr.callee, ctx) + "(" + args + ")";
    }
    case "AwaitExpression": {
      return "await " + fmtExpression(expr.argument, ctx);
    }
    case "SpreadExpression": {
      return "..." + fmtExpression(expr.argument, ctx);
    }
    case "TernaryExpression": {
      return fmtExpression(expr.condition, ctx) + " ? " + fmtExpression(expr.consequent, ctx) + " : " + fmtExpression(expr.alternate, ctx);
    }
    case "TypeofExpression": {
      return "typeof " + fmtExpression(expr.argument, ctx);
    }
    case "VoidExpression": {
      return "void " + fmtExpression(expr.argument, ctx);
    }
    case "DeleteExpression": {
      return "delete " + fmtExpression(expr.argument, ctx);
    }
    case "YieldExpression": {
      const del = expr.delegate ? "*" : "";
      if (!expr.argument) {
        return "yield" + del;
      }
      return "yield" + del + " " + fmtExpression(expr.argument, ctx);
    }
    case "AsExpression": {
      return fmtExpression(expr.expression, ctx) + " as " + fmtType(expr.typeAnnotation);
    }
    case "ComptimeExpression": {
      if (expr.body) {
        const inner = indented2(ctx);
        const body = expr.body.map((s) => fmtStatement(s, inner)).join("\n");
        return `comptime {
` + body + "\n" + pad2(ctx) + "}";
      }
      return "comptime " + fmtExpression(expr.expression, ctx);
    }
    case "IfExpression": {
      const inner = indented2(ctx);
      const cond2 = fmtExpression(expr.condition, ctx);
      const thenBody = expr.consequent.map((s) => fmtStatement(s, inner)).join("\n");
      const elseBody = expr.alternate.map((s) => fmtStatement(s, inner)).join("\n");
      return "if " + cond2 + ` {
` + thenBody + "\n" + pad2(ctx) + `} else {
` + elseBody + "\n" + pad2(ctx) + "}";
    }
    case "RegExpLiteral": {
      return expr.flags ? "/" + expr.pattern + "/" + expr.flags : "/" + expr.pattern + "/";
    }
    case "ObjectPattern": {
      return fmtPattern(expr);
    }
    case "ArrayPattern": {
      return fmtPattern(expr);
    }
    default: {
      return "/* unsupported: " + expr.type + " */";
    }
  }
}
function fmtLiteral(lit) {
  switch (lit.literalType) {
    case "number": {
      return String(lit.value);
    }
    case "string": {
      const escaped = String(lit.value).replace(/"/g, '\\"');
      return '"' + escaped + '"';
    }
    case "boolean": {
      return String(lit.value);
    }
    case "null": {
      return "null";
    }
    case "undefined": {
      return "undefined";
    }
    default: {
      return String(lit.value);
    }
  }
}
function fmtCall(call, ctx) {
  const callee = fmtExpression(call.callee, ctx);
  const chain = call.optional ? "?." : "";
  const parts = call.arguments.map((a) => fmtExpression(a, ctx));
  if (call.namedArgs && call.namedArgs.length > 0) {
    for (const na of call.namedArgs) {
      parts.push(na.name.name + ": " + fmtExpression(na.value, ctx));
    }
  }
  return callee + chain + "(" + parts.join(", ") + ")";
}
function fmtBinary(bin, ctx) {
  const left = fmtExpression(bin.left, ctx);
  const right = fmtExpression(bin.right, ctx);
  return left + " " + bin.operator + " " + right;
}
function fmtMember(mem, ctx) {
  const obj = fmtExpression(mem.object, ctx);
  const chain = mem.optional ? "?." : "";
  if (mem.computed) {
    return obj + chain + "[" + fmtExpression(mem.property, ctx) + "]";
  }
  const prop = fmtExpression(mem.property, ctx);
  return obj + chain + chain ? "" : "." + prop;
}
function fmtArray(arr, ctx) {
  const els = arr.elements.map((e) => fmtExpression(e, ctx)).join(", ");
  return "[" + els + "]";
}
function fmtObject(obj, ctx) {
  if (obj.properties.length === 0) {
    return "{}";
  }
  const props = obj.properties.map((p) => fmtObjectProp(p, ctx)).join(", ");
  return "{ " + props + " }";
}
function fmtObjectProp(prop, ctx) {
  if (prop.shorthand) {
    return fmtExpression(prop.key, ctx);
  }
  let keyStr = "";
  if (prop.computed) {
    keyStr = "[" + fmtExpression(prop.key, ctx) + "]";
  } else {
    keyStr = fmtExpression(prop.key, ctx);
  }
  return keyStr + ": " + fmtExpression(prop.value, ctx);
}
function fmtArrow(f, ctx) {
  const prefix = f.async ? "async " : "";
  const params = f.params.map((p) => fmtParam(p)).join(", ");
  const ret = f.returnType ? ": " + fmtType(f.returnType) : "";
  if (Array.isArray(f.body)) {
    const inner = indented2(ctx);
    const body = f.body.map((s) => fmtStatement(s, inner)).join("\n");
    return prefix + "(" + params + ")" + ret + ` => {
` + body + "\n" + pad2(ctx) + "}";
  }
  return prefix + "(" + params + ")" + ret + " => " + fmtExpression(f.body, ctx);
}
function fmtTemplate(tmpl, ctx) {
  let out = "`";
  for (const part of tmpl.parts) {
    if (part.kind === "Text") {
      out = out + part.value;
    } else {
      out = out + "${" + fmtExpression(part.expression, ctx) + "}";
    }
  }
  out = out + "`";
  return out;
}
function fmtPattern(pat) {
  if (pat.type === "ObjectPattern") {
    const props = pat.properties.map((p) => {
      if (p.shorthand) {
        return p.key.name;
      }
      const val = p.value.type === "Identifier" ? p.value.name : fmtPattern(p.value);
      let out = p.key.name + ": " + val;
      if (p.defaultValue) {
        out = out + " = " + fmtExpression(p.defaultValue, { indent: 0, options: { indentSize: 2, maxLineWidth: 100 } });
      }
      return out;
    });
    if (pat.rest) {
      props.push("..." + pat.rest.name);
    }
    return "{ " + props.join(", ") + " }";
  }
  const els = pat.elements.map((e) => {
    if (e === null) {
      return "";
    }
    if (e.type === "Identifier") {
      return e.name;
    }
    return fmtPattern(e);
  });
  if (pat.rest) {
    els.push("..." + pat.rest.name);
  }
  return "[" + els.join(", ") + "]";
}
function fmtType(t) {
  switch (t.kind) {
    case "named": {
      return t.name;
    }
    case "array": {
      return fmtType(t.elementType) + "[]";
    }
    case "union": {
      return t.types.map((x) => fmtType(x)).join(" | ");
    }
    case "intersection": {
      return t.types.map((x) => fmtType(x)).join(" & ");
    }
    case "generic": {
      return t.name + "<" + t.args.map((x) => fmtType(x)).join(", ") + ">";
    }
    case "function": {
      const params = t.params.map((x) => fmtType(x)).join(", ");
      return "(" + params + ") => " + fmtType(t.returnType);
    }
    case "object": {
      const props = t.properties.map((p) => {
        const opt = p.optional ? "?" : "";
        return p.key + opt + ": " + fmtType(p.value);
      }).join(", ");
      return "{ " + props + " }";
    }
    case "tuple": {
      return "[" + t.elements.map((x) => fmtType(x)).join(", ") + "]";
    }
    case "literal": {
      return JSON.stringify(t.value);
    }
    case "nullable": {
      return fmtType(t.inner) + "?";
    }
    default: {
      return "any";
    }
  }
}
var init_formatter = __esm({
  "dist/compiler/formatter/formatter.js"() {
  }
});

// dist/compiler/plugin.js
var PluginRegistry, defaultRegistry;
var init_plugin = __esm({
  "dist/compiler/plugin.js"() {
    PluginRegistry = class {
      #plugins = [];
      register(plugin) {
        return this.#plugins.push(plugin);
      }
      unregister(name) {
        return this.#plugins = this.#plugins.filter((p) => p.name !== name);
      }
      getPlugins() {
        return this.#plugins;
      }
      clear() {
        return this.#plugins = [];
      }
      runBeforeParse(source, ctx) {
        let result = source;
        for (const plugin of this.#plugins) {
          if (plugin.beforeParse) {
            result = plugin.beforeParse(result, ctx);
          }
        }
        return result;
      }
      runAfterParse(ast, ctx) {
        let result = ast;
        for (const plugin of this.#plugins) {
          if (plugin.afterParse) {
            result = plugin.afterParse(result, ctx);
          }
        }
        return result;
      }
      runBeforeGenerate(ast, ctx) {
        let result = ast;
        for (const plugin of this.#plugins) {
          if (plugin.beforeGenerate) {
            result = plugin.beforeGenerate(result, ctx);
          }
        }
        return result;
      }
      runAfterGenerate(js, ctx) {
        let result = js;
        for (const plugin of this.#plugins) {
          if (plugin.afterGenerate) {
            result = plugin.afterGenerate(result, ctx);
          }
        }
        return result;
      }
      runResolveImport(specifier, fromFile) {
        for (const plugin of this.#plugins) {
          if (plugin.resolveImport) {
            const resolved = plugin.resolveImport(specifier, fromFile);
            if (resolved !== null) {
              return resolved;
            }
          }
        }
        return null;
      }
    };
    defaultRegistry = new PluginRegistry();
  }
});

// dist/compiler/compile.js
var compile_exports = {};
__export(compile_exports, {
  Lexer: () => Lexer,
  Parser: () => Parser,
  PluginRegistry: () => PluginRegistry,
  SourceMapBuilder: () => SourceMapBuilder,
  compile: () => compile,
  compileToAST: () => compileToAST,
  compileWithSourceMap: () => compileWithSourceMap,
  defaultRegistry: () => defaultRegistry,
  format: () => format,
  generateJS: () => generateJS,
  generateJSWithSourceMap: () => generateJSWithSourceMap,
  typeCheck: () => typeCheck
});
function compile(source, options) {
  const opts = options ?? {};
  const registry = opts.plugins ?? defaultRegistry;
  const ctx = { filePath: opts.filePath, compileOptions: opts, metadata: {} };
  const transformedSource = registry.runBeforeParse(source, ctx);
  let ast = compileToAST(transformedSource);
  ast = registry.runAfterParse(ast, ctx);
  const rawErrors = ast.errors ?? [];
  const parserErrors = [];
  for (const err of rawErrors) {
    parserErrors.push({ message: err.message, source: "parser" });
  }
  const typeErrors = opts.check ? typeCheck(ast) : [];
  const diagnostics = parserErrors.concat(typeErrors);
  ast = registry.runBeforeGenerate(ast, ctx);
  let js = generateJS(ast, opts.minify ?? false);
  js = registry.runAfterGenerate(js, ctx);
  return { js, ast, diagnostics };
}
function compileWithSourceMap(source, sourceFile, outputFile, options) {
  const opts = options ?? {};
  const registry = opts.plugins ?? defaultRegistry;
  const ctx = { filePath: opts.filePath ?? sourceFile, compileOptions: opts, metadata: {} };
  const transformedSource = registry.runBeforeParse(source, ctx);
  let ast = compileToAST(transformedSource);
  ast = registry.runAfterParse(ast, ctx);
  ast = registry.runBeforeGenerate(ast, ctx);
  const result = generateJSWithSourceMap(ast, sourceFile, transformedSource, outputFile, opts.minify ?? false);
  const js = registry.runAfterGenerate(result.js, ctx);
  return { js, ast, sourceMap: result.sourceMap };
}
function compileToAST(source) {
  const tokens = new Lexer(source).tokenize();
  return new Parser(tokens, source).parseProgram();
}
var init_compile = __esm({
  "dist/compiler/compile.js"() {
    init_lexer();
    init_parser();
    init_js_generator();
    init_type_checker();
    init_source_map();
    init_formatter();
    init_plugin();
    init_lexer();
    init_parser();
    init_js_generator();
    init_source_map();
    init_type_checker();
    init_formatter();
    init_plugin();
  }
});

// dist/cli/index.js
var cli_exports = {};
__export(cli_exports, {
  main: () => main
});
module.exports = __toCommonJS(cli_exports);

// dist/cli/utils/colors.js
var RED = "\x1B[31m";
var GREEN = "\x1B[32m";
var YELLOW = "\x1B[33m";
var CYAN = "\x1B[36m";
var DIM = "\x1B[2m";
var BOLD = "\x1B[1m";
var RESET = "\x1B[0m";

// dist/cli/utils/strings.js
function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  const dp = new Array(n + 1);
  let j = 0;
  while (j <= n) {
    dp[j] = j;
    j = j + 1;
  }
  let i = 1;
  while (i <= m) {
    let prev = dp[0];
    dp[0] = i;
    let jj = 1;
    while (jj <= n) {
      const temp = dp[jj];
      dp[jj] = Math.min(dp[jj] + 1, dp[jj - 1] + 1, prev + a[i - 1] === b[jj - 1] ? 0 : 1);
      prev = temp;
      jj = jj + 1;
    }
    i = i + 1;
  }
  return dp[n];
}
function suggestClosest(input, candidates, maxDistance) {
  const maxDist = maxDistance ?? 2;
  let best = null;
  for (const candidate of candidates) {
    const dist = levenshtein(input, candidate);
    if (dist <= maxDist && (!best || dist < best.dist)) {
      best = { name: candidate, dist };
    }
  }
  return best ? best.name : null;
}

// dist/cli/commands/help.js
var version = "0.2.0";
var helpText = `nodeon v${version}

Usage: nodeon <command> [options]

Project:
  new <name>                         Create a new project
  init [name]                        Initialize in existing directory
  dev [--port 3000]                   Start development server with live reload

Compile:
  build [options] <input> [output]   Compile .no to .js
  run <input>                        Compile and execute
  check <input>                      Type-check without compiling

Code Quality:
  test [pattern]                     Run .test.no files
  fmt <input>                        Format .no source code
  repl                               Interactive REPL

Generate:
  generate entity <name>             Model + migration + service + API + tests
  generate page <path>               Page component
  generate component <name>          Server component
  generate island <name>             Interactive island component
  generate service <name>            Injectable service
  generate middleware <name>         Request middleware
  generate job <name>                Background job
  generate module <name>             Full module (all of the above)
  (alias: g)

Info:
  help                               Show this help
  version                            Show version

Build Options:
  -min, --minify    Minified output
  --map             Generate source map (.js.map)
  --check           Enable type checking

Examples:
  nodeon new my-app                  Create a full-stack project
  nodeon build hello.no              Compile to hello.js
  nodeon run hello.no                Compile and execute
  nodeon test                        Run all tests
  nodeon g entity user               Generate user entity + CRUD
  nodeon g module blog               Generate complete blog module`;
function printHelp() {
  return console.log(helpText);
}
function printVersion() {
  return console.log(CYAN + BOLD + "nodeon v" + version + RESET);
}

// dist/cli/commands/init.js
var fs = require("fs");
var path = require("path");
var MAIN_TEMPLATE = `// Entry point
fn main() {
  print("Hello from Nodeon!")
}

main()
`;
function configTemplate(name) {
  return JSON.stringify({ name, version: "0.1.0", entry: "src/main.no", outDir: "dist", strict: false }, null, 2) + "\n";
}
var GITIGNORE_TEMPLATE = `node_modules/
dist/
.nodeon-cache/
`;
function runInit(args) {
  const dir = process.cwd();
  const projectName = args[0] || path.basename(dir);
  const files = [["src/main.no", MAIN_TEMPLATE], ["nodeon.json", configTemplate(projectName)], [".gitignore", GITIGNORE_TEMPLATE]];
  let created = 0;
  let skipped = 0;
  for (const entry of files) {
    const rel = entry[0];
    const content = entry[1];
    const full = path.join(dir, rel);
    if (fs.existsSync(full)) {
      console.log("  " + DIM + "skip" + RESET + " " + rel + " (already exists)");
      skipped = skipped + 1;
      continue;
    }
    const parent = path.join(dir, rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "");
    if (!fs.existsSync(parent)) {
      fs.mkdirSync(parent, { recursive: true });
    }
    fs.writeFileSync(full, content, "utf8");
    console.log("  " + GREEN + "+" + RESET + " " + rel);
    created = created + 1;
  }
  console.log("\n" + GREEN + "project initialized" + RESET + " (" + created + " created, " + skipped + " skipped)");
  console.log(DIM + "run: nodeon run src/main.no" + RESET);
}

// dist/cli/utils/errors.js
function offsetToLineCol(src, offset) {
  let line = 1;
  let col = 1;
  let i = 0;
  while (i < src.length && i < offset) {
    if (src[i] === "\n") {
      line = line + 1;
      col = 1;
    } else {
      col = col + 1;
    }
    i = i + 1;
  }
  return { line, col };
}
function formatError(file, source, err) {
  const out = [];
  if (err.code && err.line && err.column) {
    return formatNodeonError(file, source, err);
  }
  out.push(RED + BOLD + "error" + RESET + ": " + err.message);
  const locMatch = err.message.match(/at (\d+):(\d+)$/);
  const posMatch = err.message.match(/position\s+(\d+)/i) || err.message.match(/pos(?:ition)?[: ](\d+)/i);
  if (source && (locMatch || posMatch)) {
    let line = 0;
    let col = 0;
    if (locMatch) {
      line = parseInt(locMatch[1], 10);
      col = parseInt(locMatch[2], 10);
    } else if (posMatch) {
      const offset = parseInt(posMatch[1], 10);
      const pos = offsetToLineCol(source, offset);
      line = pos.line;
      col = pos.col;
    }
    if (line > 0 && col > 0) {
      appendSourceContext(out, file, source, line, col);
      return out.join("\n");
    }
  }
  out.push("  " + DIM + "-->" + RESET + " " + CYAN + file + RESET);
  return out.join("\n");
}
function formatNodeonError(file, source, err) {
  const out = [];
  const msgClean = err.message.replace(/\s+at\s+\d+:\d+$/, "");
  out.push(RED + BOLD + "error[" + err.code + "]" + RESET + ": " + msgClean);
  if (source && err.line > 0 && err.column > 0) {
    appendSourceContext(out, file, source, err.line, err.column);
  } else {
    out.push("  " + DIM + "-->" + RESET + " " + CYAN + file + RESET);
  }
  if (err.help && err.help.length > 0) {
    out.push("  " + DIM + "     " + RESET);
    for (const hint of err.help) {
      out.push("  " + YELLOW + BOLD + "help" + RESET + ": " + hint);
    }
  }
  return out.join("\n");
}
function appendSourceContext(out, file, source, line, col) {
  const srcLines = source.split("\n");
  const lineStr = srcLines[line - 1] ?? "";
  const gutterWidth = String(line).length;
  const gutter = " ".repeat(gutterWidth);
  out.push("  " + DIM + "-->" + RESET + " " + CYAN + file + ":" + line + ":" + col + RESET);
  out.push("  " + DIM + gutter + " |" + RESET);
  if (line > 1) {
    const prevLine = srcLines[line - 2] ?? "";
    if (prevLine.trim().length > 0) {
      const prevNum = String(line - 1).padStart(gutterWidth);
      out.push("  " + DIM + prevNum + " |" + RESET + " " + prevLine);
    }
  }
  const lineNum = String(line).padStart(gutterWidth);
  out.push("  " + DIM + lineNum + " |" + RESET + " " + lineStr);
  out.push("  " + DIM + gutter + " |" + RESET + " " + " ".repeat(Math.max(0, col - 1)) + RED + "^" + RESET);
}

// dist/cli/utils/compile.js
var fs2 = require("fs");
var path2 = require("path");
var crypto = require("crypto");
var os = require("os");
var CACHE_MODE = process.env.NODEON_CACHE ?? "".toLowerCase();
var CACHE_DISABLED = CACHE_MODE === "none" || CACHE_MODE === "memory";
var CACHE_DIR = process.env.NODEON_CACHE_DIR ? path2.resolve(process.cwd(), process.env.NODEON_CACHE_DIR) : path2.resolve(process.cwd(), "node_modules", ".cache", "nodeon");
var compilerModule = null;
function getCompiler() {
  if (!compilerModule) {
    const candidates = [path2.resolve(__dirname, "..", "nodeon-compiler.cjs"), path2.resolve(__dirname, "..", "..", "nodeon-compiler.cjs"), path2.resolve(process.cwd(), "dist", "nodeon-compiler.cjs"), path2.resolve(__dirname, "compiler", "compile.js"), path2.resolve(__dirname, "..", "compiler", "compile.js"), path2.resolve(__dirname, "..", "..", "compiler", "compile.js"), path2.resolve(__dirname, "compiler", "compile.no"), path2.resolve(__dirname, "..", "compiler", "compile.no"), path2.resolve(__dirname, "..", "..", "compiler", "compile.no")];
    for (const c of candidates) {
      try {
        compilerModule = require(c);
        break;
      } catch (err) {
        if (err.code !== "MODULE_NOT_FOUND") {
          throw err;
        }
      }
    }
  }
  return compilerModule;
}
function resolveOutFileName(outputPath, absIn, minify) {
  if (outputPath) {
    return path2.basename(outputPath);
  }
  if (minify) {
    return path2.basename(absIn).replace(/\.no$/, ".min.js");
  }
  return path2.basename(absIn).replace(/\.no$/, ".js");
}
function computeCacheKey(inputPath, source, minify, sourceMap, outFileName) {
  const hash = crypto.createHash("sha1");
  hash.update(inputPath);
  hash.update("|");
  hash.update(source);
  hash.update("|");
  hash.update(minify ? "1" : "0");
  hash.update("|");
  hash.update(sourceMap ? "1" : "0");
  hash.update("|");
  hash.update(outFileName);
  return hash.digest("hex");
}
function computeOutputPath(outputPath, absIn, options) {
  if (options.write) {
    if (outputPath) {
      return path2.resolve(process.cwd(), outputPath);
    }
    if (options.minify) {
      return absIn.replace(/\.no$/, ".min.js");
    }
    return absIn.replace(/\.no$/, ".js");
  }
  return null;
}
function compileFile(inputPath, outputPath, opts) {
  const options = opts ?? { minify: false, write: true };
  const absIn = path2.resolve(process.cwd(), inputPath);
  if (!fs2.existsSync(absIn)) {
    throw new Error("file not found: " + inputPath);
  }
  const source = fs2.readFileSync(absIn, "utf8");
  const cacheDir = CACHE_DIR;
  const outFileName = resolveOutFileName(outputPath, absIn, options.minify);
  const cacheKey = computeCacheKey(inputPath, source, options.minify, options.sourceMap, outFileName);
  const cachePath = path2.join(cacheDir, cacheKey + ".json");
  try {
    let out = computeOutputPath(outputPath, absIn, options);
    if (!CACHE_DISABLED) {
      if (!fs2.existsSync(cacheDir)) {
        fs2.mkdirSync(cacheDir, { recursive: true });
      }
      if (fs2.existsSync(cachePath)) {
        const cached = JSON.parse(fs2.readFileSync(cachePath, "utf8"));
        if (options.sourceMap && cached.sourceMap && out) {
          fs2.writeFileSync(out, cached.jsCode, "utf8");
          fs2.writeFileSync(out + ".map", JSON.stringify(cached.sourceMap), "utf8");
        } else if (options.write && out) {
          fs2.writeFileSync(out, cached.jsCode, "utf8");
        }
        return { ast: null, jsCode: cached.jsCode, out };
      }
    }
    const compiler = getCompiler();
    const result = compiler.compile(source, { minify: options.minify, check: options.check });
    const jsCode = result.js;
    const ast = result.ast;
    const diagnostics = result.diagnostics;
    if (!CACHE_DISABLED) {
      fs2.writeFileSync(cachePath, JSON.stringify({ jsCode }), "utf8");
    }
    if (out) {
      fs2.writeFileSync(out, jsCode, "utf8");
    }
    return { ast, jsCode, out, diagnostics };
  } catch (err) {
    console.error(formatError(inputPath, source, err));
    process.exit(1);
  }
}

// dist/cli/utils/runtime.js
var vm = require("vm");
var fs3 = require("fs");
var path3 = require("path");
var ReferenceError2 = globalThis.ReferenceError;
var URIError = globalThis.URIError;
var EvalError = globalThis.EvalError;
var URL2 = globalThis.URL;
var URLSearchParams2 = globalThis.URLSearchParams;
var TextEncoder = globalThis.TextEncoder;
var TextDecoder = globalThis.TextDecoder;
var queueMicrotask2 = globalThis.queueMicrotask;
var Intl = globalThis.Intl;
var sandboxGlobals = { console, setTimeout, setInterval, clearTimeout, clearInterval, JSON, Math, Date, RegExp, Error, TypeError, RangeError, SyntaxError, ReferenceError: ReferenceError2, URIError, EvalError, parseInt, parseFloat, isNaN, isFinite, encodeURIComponent, decodeURIComponent, encodeURI, decodeURI, Array, Object, String, Number, Boolean, Map, Set, WeakMap, WeakSet, Promise, Symbol, Proxy, Reflect, require, process, Buffer, URL: URL2, URLSearchParams: URLSearchParams2, TextEncoder, TextDecoder, queueMicrotask: queueMicrotask2, Intl, globalThis };
function runInSandbox(jsCode, filename) {
  const cjsCode = esmToCjs(jsCode);
  const absFile = path3.resolve(process.cwd(), filename);
  try {
    const ctx = Object.assign({}, sandboxGlobals, { __filename: absFile, __dirname: path3.dirname(absFile), module: { exports: {} }, exports: {} });
    vm.runInNewContext(cjsCode, ctx, { filename });
  } catch (err) {
    const name = err?.name || "RuntimeError";
    const message = err?.message || String(err);
    const stack = typeof err?.stack === "string" ? err.stack : "";
    const locMatch = stack.match(/([^\s()]+\.\w+):(\d+):(\d+)/);
    const lineNum = locMatch ? Number(locMatch[2]) : 1;
    const colNum = locMatch ? Number(locMatch[3]) : 1;
    const fileOnStack = locMatch ? locMatch[1] : filename;
    const candidateNo = fileOnStack.endsWith(".no") ? fileOnStack : fileOnStack.replace(/\.js$/, ".no");
    const resolvedNo = path3.resolve(process.cwd(), candidateNo);
    const resolvedJs = path3.resolve(process.cwd(), fileOnStack);
    const filePath = fs3.existsSync(resolvedNo) ? resolvedNo : resolvedJs;
    let sourceLine = "";
    if (fs3.existsSync(filePath)) {
      const fileLines = fs3.readFileSync(filePath, "utf8").split(/\r?\n/);
      sourceLine = fileLines[lineNum - 1] ?? "";
    }
    const relPath = filePath ? filePath.replace(process.cwd() + path3.sep, "") : fileOnStack;
    console.error(RED + BOLD + name + RESET + ": " + message);
    console.error(DIM + "  --> " + RESET + CYAN + relPath + ":" + lineNum + ":" + colNum + RESET);
    if (sourceLine) {
      console.error("   " + lineNum + " | " + sourceLine);
      const marker = " ".repeat(Math.max(0, String(lineNum).length + 3 + Math.max(0, colNum - 1))) + "^";
      console.error("   " + marker);
    }
    process.exit(1);
  }
}
function esmToCjs(code2) {
  let out = code2;
  out = out.replace(~/^[\t ]*import\s+([A-Za-z_$][\w$]*)\s+from\s+["']([^"']+)["'];?/gm, (m, def, src) => `const ${def} = require(${JSON.stringify(src)});`);
  out = out.replace(~/^[\t ]*import\s+\*\s+as\s+([A-Za-z_$][\w$]*)\s+from\s+["']([^"']+)["'];?/gm, (m, ns, src) => `const ${ns} = require(${JSON.stringify(src)});`);
  out = out.replace(~/^[\t ]*import\s+{\s*([^}]+)\s*}\s+from\s+["']([^"']+)["'];?/gm, (m, names, src) => {
    const mapped = names.split(",").map((n) => {
      const [orig, alias] = n.trim().split(/\s+as\s+/i);
      return alias ? `${orig}: ${alias}` : orig;
    }).filter(Boolean).join(", ");
    return `const { ${mapped} } = require(${JSON.stringify(src)});`;
  });
  out = out.replace(~/^[\t ]*import\s+([A-Za-z_$][\w$]*)\s*,\s*{\s*([^}]+)\s*}\s+from\s+["']([^"']+)["'];?/gm, (m, def, names, src) => {
    const mapped = names.split(",").map((n) => {
      const [orig, alias] = n.trim().split(/\s+as\s+/i);
      return alias ? `${orig}: ${alias}` : orig;
    }).filter(Boolean).join(", ");
    const tmp = `__mod_${Math.random().toString(36).slice(2)}`;
    return `const ${tmp} = require(${JSON.stringify(src)});
const ${def} = ${tmp}.default ?? ${tmp};
const { ${mapped} } = ${tmp};`;
  });
  out = out.replace(~/^[\t ]*export\s+default\s+/gm, "module.exports = ");
  out = out.replace(~/^[\t ]*export\s+(const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/gm, (m, kind, name) => `${kind} ${name}
exports.${name} = ${name}`);
  out = out.replace(~/^[\t ]*export\s+{\s*([^}]+)\s*};?/gm, (m, names) => names.split(",").map((n) => {
    const [orig, alias] = n.trim().split(/\s+as\s+/i);
    const target = alias || orig;
    const source = orig;
    return `exports.${target} = ${source};`;
  }).join("\n"));
  return out;
}

// dist/cli/commands/run.js
var fs4 = require("fs");
var path4 = require("path");
function resolveNodeonFile(input) {
  const candidates = [input, input + ".no", path4.join(input, "index.no")];
  for (const candidate of candidates) {
    const abs = path4.resolve(process.cwd(), candidate);
    if (fs4.existsSync(abs)) {
      return candidate;
    }
  }
  const suggestion = suggestClosestFile(input);
  const msg = suggestion ? "file not found: " + input + " (did you mean: " + suggestion + " ?)" : "file not found: " + input;
  throw new Error(msg);
}
function suggestClosestFile(input) {
  const parsed = path4.basename(input);
  const dir = path4.dirname(input) === "." ? "." : path4.dirname(input);
  const desired = parsed.includes(".") ? parsed : parsed + ".no";
  const dirAbs = path4.resolve(process.cwd(), dir);
  try {
    const entries = fs4.readdirSync(dirAbs, { withFileTypes: true });
    const noFiles = entries.filter((e) => e.isFile() && e.name.endsWith(".no")).map((e) => e.name);
    return suggestClosest(desired, noFiles, 3);
  } catch (e) {
    return null;
  }
}
function runRun(args) {
  const watchMode = args.includes("-w") || args.includes("--watch");
  const positional = args.filter((f) => !f.startsWith("-"));
  const input = positional[0];
  if (!input) {
    console.error("run requires an input .no file");
    process.exit(1);
  }
  let resolvedInput = "";
  try {
    resolvedInput = resolveNodeonFile(input);
  } catch (err) {
    console.error(RED + "error" + RESET + ": " + err.message);
    process.exit(1);
  }
  executeFile(resolvedInput);
  if (watchMode) {
    console.log("\n" + DIM + "watching " + path4.basename(resolvedInput) + " for changes..." + RESET + " (Ctrl+C to stop)");
    watchAndRun(resolvedInput);
  }
}
function executeFile(resolvedInput) {
  try {
    const result = compileFile(resolvedInput, void 0, { minify: false, write: false });
    if (!result) {
      return false;
    }
    const jsCode = result.jsCode;
    runInSandbox(jsCode, path4.basename(resolvedInput).replace(/\.no$/, ".js"));
    return true;
  } catch (err) {
    if (err instanceof SyntaxError || err.name === "SyntaxError") {
      console.error(RED + "error" + RESET + ": " + err.message);
    } else {
      console.error(RED + BOLD + "runtime error" + RESET + ": " + err.message);
    }
    return false;
  }
}
function watchAndRun(resolvedInput) {
  const absInput = path4.resolve(resolvedInput);
  const dir = path4.dirname(absInput);
  let debounceTimer = null;
  const watcher = fs4.watch(dir, (eventType, filename) => {
    if (!filename || !filename.endsWith(".no")) {
      return;
    }
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(() => {
      console.log("\n" + DIM + "change detected: " + filename + RESET);
      console.log("-".repeat(40));
      executeFile(resolvedInput);
      console.log("\n" + DIM + "waiting for changes..." + RESET);
    }, 150);
  });
  const keepAlive = setInterval(() => {
  }, 2147483647);
  process.on("SIGINT", () => {
    watcher.close();
    clearInterval(keepAlive);
    console.log("\n" + DIM + "watch stopped." + RESET);
    process.exit(0);
  });
}

// dist/cli/commands/build.js
var fs5 = require("fs");
var path5 = require("path");
function loadConfig() {
  const configPath = path5.resolve(process.cwd(), "nodeon.json");
  if (!fs5.existsSync(configPath)) {
    return null;
  }
  try {
    return JSON.parse(fs5.readFileSync(configPath, "utf8"));
  } catch (e) {
    return null;
  }
}
function runBuild(args) {
  const flags = args;
  const positional = flags.filter((f) => !f.startsWith("-"));
  const config = loadConfig();
  const minify = flags.includes("-min") || flags.includes("--minify") || (config?.minify ?? false);
  const sourceMap = flags.includes("--map") || (config?.sourceMap ?? false);
  const check = flags.includes("--check") || (config?.strict ?? false);
  let inputArg = positional[0];
  if (!inputArg && config?.entry) {
    inputArg = config.entry;
    console.log(DIM + "using nodeon.json entry: " + config.entry + RESET);
  }
  if (!inputArg) {
    console.error("build requires an input .no file (or a nodeon.json with 'entry')");
    process.exit(1);
  }
  let input = "";
  try {
    input = resolveNodeonFile(inputArg);
  } catch (err) {
    console.error(RED + "error" + RESET + ": " + err.message);
    process.exit(1);
  }
  const output = positional[1] || config?.outDir ? path5.resolve(config.outDir, path5.basename(input).replace(/\.no$/, ".js")) : void 0;
  const absInput = path5.resolve(input);
  const filesToCompile = collectDependencies(absInput);
  let compiled = 0;
  let failed = 0;
  for (const file of filesToCompile) {
    const relFile = path5.relative(process.cwd(), file);
    try {
      const outPath = file === absInput ? output : void 0;
      const result = compileFile(relFile, outPath, { minify, write: true, sourceMap, check });
      const extra = [minify ? "minified" : "", sourceMap ? "+map" : ""].filter(Boolean).join(", ");
      console.log("  " + GREEN + "\u2713" + RESET + " " + path5.basename(relFile) + " \u2192 " + path5.basename(result.out) + extra ? " (" + extra + ")" : "");
      if (result.diagnostics && result.diagnostics.length > 0) {
        printDiagnostics(relFile, result.diagnostics);
      }
      compiled = compiled + 1;
    } catch (err) {
      console.error("  " + RED + "\u2717" + RESET + " " + path5.basename(relFile) + ": " + err.message);
      failed = failed + 1;
    }
  }
  if (filesToCompile.length > 1) {
    console.log("\n" + DIM + compiled + " compiled" + failed ? ", " + failed + " failed" : "" + RESET);
  }
}
function printDiagnostics(file, diagnostics) {
  for (const d of diagnostics) {
    let sev = DIM + "hint" + RESET;
    if (d.severity === "error") {
      sev = RED + "error" + RESET;
    }
    if (d.severity === "warning") {
      sev = YELLOW + "warn" + RESET;
    }
    console.log("    " + sev + ": " + d.message + " " + DIM + "(" + file + ":" + d.line + 1 + ":" + d.column + 1 + ")" + RESET);
  }
}
function collectDependencies(entryFile) {
  const visited = /* @__PURE__ */ new Set();
  const ordered = [];
  const compiler = (init_compile(), __toCommonJS(compile_exports)) ?? (init_compile(), __toCommonJS(compile_exports));
  const resolver = (init_resolver(), __toCommonJS(resolver_exports)) ?? (init_resolver(), __toCommonJS(resolver_exports));
  function walk(absFile) {
    if (visited.has(absFile)) {
      return;
    }
    visited.add(absFile);
    try {
      const source = fs5.readFileSync(absFile, "utf8");
      const ast = compiler.compileToAST(source);
      for (const stmt of ast.body) {
        let importSource = void 0;
        if (stmt.type === "ImportDeclaration") {
          importSource = stmt.source;
        } else if (stmt.type === "ExportDeclaration" && stmt.source) {
          importSource = stmt.source;
        }
        if (importSource) {
          const resolved = resolver.resolveImport(importSource, absFile);
          if (resolved) {
            walk(resolved);
          }
        }
      }
    } catch (e) {
    }
    ordered.push(absFile);
  }
  walk(entryFile);
  return ordered;
}

// dist/cli/commands/check.js
var fs6 = require("fs");
var path6 = require("path");
function runCheck(args) {
  const positional = args.filter((f) => !f.startsWith("-"));
  const inputArg = positional[0];
  if (!inputArg) {
    console.error("check requires an input .no file");
    process.exit(1);
  }
  let input = "";
  try {
    input = resolveNodeonFile(inputArg);
  } catch (err) {
    console.error(RED + "error" + RESET + ": " + err.message);
    process.exit(1);
  }
  const absInput = path6.resolve(input);
  const files = collectFiles(absInput);
  let totalErrors = 0;
  let totalWarnings = 0;
  let totalFiles = 0;
  const compiler = (init_compile(), __toCommonJS(compile_exports));
  for (const file of files) {
    const relFile = path6.relative(process.cwd(), file);
    try {
      const source = fs6.readFileSync(file, "utf8");
      const ast = compiler.compileToAST(source);
      const diagnostics = compiler.compile(source, { check: true }).diagnostics;
      const errors = diagnostics.filter((d) => d.severity === "error");
      const warnings = diagnostics.filter((d) => d.severity === "warning");
      if (diagnostics.length === 0) {
        console.log("  " + GREEN + "\u2713" + RESET + " " + path6.basename(relFile));
      } else {
        console.log("  " + RED + "\u2717" + RESET + " " + path6.basename(relFile));
        for (const d of diagnostics) {
          let sev = DIM + "hint" + RESET;
          if (d.severity === "error") {
            sev = RED + "error" + RESET;
          }
          if (d.severity === "warning") {
            sev = YELLOW + "warn" + RESET;
          }
          console.log("    " + sev + ": " + d.message + " " + DIM + "(" + relFile + ":" + d.line + 1 + ":" + d.column + 1 + ")" + RESET);
        }
      }
      totalErrors = totalErrors + errors.length;
      totalWarnings = totalWarnings + warnings.length;
      totalFiles = totalFiles + 1;
    } catch (err) {
      const source = fs6.existsSync(file) ? fs6.readFileSync(file, "utf8") : "";
      console.error("  " + RED + "\u2717" + RESET + " " + path6.basename(relFile));
      console.error("    " + formatError(relFile, source, err));
      totalErrors = totalErrors + 1;
      totalFiles = totalFiles + 1;
    }
  }
  console.log();
  if (totalErrors === 0 && totalWarnings === 0) {
    const plural = totalFiles > 1 ? "s" : "";
    console.log(GREEN + "\u2713 " + totalFiles + " file" + plural + " checked \u2014 no issues found" + RESET);
  } else {
    const parts = [];
    if (totalErrors > 0) {
      const ep = totalErrors > 1 ? "s" : "";
      parts.push(RED + totalErrors + " error" + ep + RESET);
    }
    if (totalWarnings > 0) {
      const wp = totalWarnings > 1 ? "s" : "";
      parts.push(YELLOW + totalWarnings + " warning" + wp + RESET);
    }
    const plural = totalFiles > 1 ? "s" : "";
    console.log(totalFiles + " file" + plural + " checked \u2014 " + parts.join(", "));
    if (totalErrors > 0) {
      process.exit(1);
    }
  }
}
function collectFiles(entryFile) {
  const visited = /* @__PURE__ */ new Set();
  const ordered = [];
  const compiler = (init_compile(), __toCommonJS(compile_exports)) ?? (init_compile(), __toCommonJS(compile_exports));
  const resolver = (init_resolver(), __toCommonJS(resolver_exports)) ?? (init_resolver(), __toCommonJS(resolver_exports));
  function walk(absFile) {
    if (visited.has(absFile)) {
      return;
    }
    visited.add(absFile);
    try {
      const source = fs6.readFileSync(absFile, "utf8");
      const ast = compiler.compileToAST(source);
      for (const stmt of ast.body) {
        let importSource = void 0;
        if (stmt.type === "ImportDeclaration") {
          importSource = stmt.source;
        } else if (stmt.type === "ExportDeclaration" && stmt.source) {
          importSource = stmt.source;
        }
        if (importSource) {
          const resolved = resolver.resolveImport(importSource, absFile);
          if (resolved) {
            walk(resolved);
          }
        }
      }
    } catch (e) {
    }
    ordered.push(absFile);
  }
  walk(entryFile);
  return ordered;
}

// dist/cli/commands/fmt.js
var fs7 = require("fs");
var path7 = require("path");
function runFmt(args) {
  const flags = args.filter((f) => f.startsWith("-"));
  const positional = args.filter((f) => !f.startsWith("-"));
  const dryRun = flags.includes("--check") || flags.includes("--dry-run");
  const inputArg = positional[0];
  if (!inputArg) {
    console.error("fmt requires an input .no file");
    process.exit(1);
  }
  let input = "";
  try {
    input = resolveNodeonFile(inputArg);
  } catch (err) {
    console.error(RED + "error" + RESET + ": " + err.message);
    process.exit(1);
  }
  const absInput = path7.resolve(input);
  const relFile = path7.relative(process.cwd(), absInput);
  try {
    const source = fs7.readFileSync(absInput, "utf8");
    const compiler = (init_compile(), __toCommonJS(compile_exports)) ?? (init_compile(), __toCommonJS(compile_exports));
    const formatter = (init_formatter(), __toCommonJS(formatter_exports)) ?? (init_formatter(), __toCommonJS(formatter_exports));
    const ast = compiler.compileToAST(source);
    const formatted = formatter.format(ast);
    if (dryRun) {
      if (source === formatted) {
        console.log("  " + GREEN + "\u2713" + RESET + " " + path7.basename(relFile) + " " + DIM + "(already formatted)" + RESET);
      } else {
        console.log("  " + YELLOW + "~" + RESET + " " + path7.basename(relFile) + " " + DIM + "(would be reformatted)" + RESET);
        process.exit(1);
      }
    } else if (source === formatted) {
      console.log("  " + GREEN + "\u2713" + RESET + " " + path7.basename(relFile) + " " + DIM + "(unchanged)" + RESET);
    } else {
      fs7.writeFileSync(absInput, formatted, "utf8");
      console.log("  " + GREEN + "\u2713" + RESET + " " + path7.basename(relFile) + " " + DIM + "(formatted)" + RESET);
    }
  } catch (err) {
    const source = fs7.existsSync(absInput) ? fs7.readFileSync(absInput, "utf8") : "";
    console.error("  " + RED + "\u2717" + RESET + " " + path7.basename(relFile));
    console.error("    " + formatError(relFile, source, err));
    process.exit(1);
  }
}

// dist/cli/commands/repl.js
init_compile();
var readline = require("readline");
var vm2 = require("vm");
function hasUnclosedBraces(src) {
  let depth = 0;
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === "(" || ch === "[") {
      depth = depth + 1;
    }
    if (ch === ")" || ch === "]") {
      depth = depth - 1;
    }
    if (ch === "{") {
      depth = depth + 1;
    }
    if (ch === "}") {
      depth = depth - 1;
    }
    i = i + 1;
  }
  return depth > 0;
}
function formatValue(val) {
  if (val === null) {
    return "null";
  }
  if (val === void 0) {
    return "undefined";
  }
  if (typeof val === "string") {
    return '"' + val + '"';
  }
  if (typeof val === "object") {
    try {
      return JSON.stringify(val, null, 2);
    } catch (e) {
      return String(val);
    }
  }
  return String(val);
}
function startRepl() {
  console.log(CYAN + "Nodeon REPL" + RESET);
  console.log(DIM + "Type .help for commands, .exit to quit" + RESET + "\n");
  const sandbox = { console, setTimeout, setInterval, clearTimeout, clearInterval, JSON, Math, Date, RegExp, Error, TypeError, RangeError, parseInt, parseFloat, isNaN, isFinite, encodeURIComponent, decodeURIComponent, Array, Object, String, Number, Boolean, Map, Set, Promise, Symbol };
  const ctx = vm2.createContext(Object.assign({}, sandbox));
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: GREEN + "nodeon>" + RESET + " ", terminal: true });
  let buffer = "";
  let multiLine = false;
  const evalInput = (input) => {
    try {
      const result = compile(input);
      const val = vm2.runInContext(result.js, ctx);
      if (val !== void 0) {
        console.log(CYAN + formatValue(val) + RESET);
      }
    } catch (err) {
      console.error(formatError("<repl>", input, err));
    }
  };
  rl.prompt();
  rl.on("line", (line) => {
    const trimmed = line.trim();
    if (!multiLine) {
      if (trimmed === ".exit" || trimmed === ".quit") {
        console.log(DIM + "Bye!" + RESET);
        rl.close();
        return;
      }
      if (trimmed === ".help") {
        console.log(CYAN + ".help" + RESET + "   Show this help");
        console.log(CYAN + ".exit" + RESET + "   Exit the REPL");
        console.log(CYAN + ".clear" + RESET + "  Clear the context\n");
        console.log(DIM + "Enter Nodeon code to compile and execute." + RESET);
        console.log(DIM + "Multi-line input auto-detects unclosed braces/parens/brackets" + RESET + "\n");
        rl.prompt();
        return;
      }
      if (trimmed === ".clear") {
        const keys = Object.keys(ctx);
        let ki = 0;
        while (ki < keys.length) {
          const k = keys[ki];
          if (sandbox[k] === void 0) {
            delete ctx[k];
          }
          ki = ki + 1;
        }
        console.log(YELLOW + "Context cleared" + RESET);
        rl.prompt();
        return;
      }
    }
    buffer = buffer + buffer ? "\n" : "" + line;
    if (hasUnclosedBraces(buffer)) {
      multiLine = true;
      rl.setPrompt(DIM + "..." + RESET + "   ");
      rl.prompt();
      return;
    }
    if (buffer.trim().length > 0) {
      evalInput(buffer);
    }
    buffer = "";
    multiLine = false;
    rl.setPrompt(GREEN + "nodeon>" + RESET + " ");
    rl.prompt();
  });
  rl.on("close", () => process.exit(0));
}

// dist/cli/commands/test.js
var fs8 = require("fs");
var path8 = require("path");
var vm3 = require("vm");
function findTestFiles(dir, pattern) {
  const results = [];
  if (!fs8.existsSync(dir)) {
    return results;
  }
  const entries = fs8.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path8.join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== "node_modules" && entry.name !== "dist" && entry.name !== ".git") {
      const sub = findTestFiles(full, pattern);
      for (const f of sub) {
        results.push(f);
      }
    } else if (entry.isFile() && entry.name.endsWith(".test.no")) {
      if (!pattern || full.includes(pattern)) {
        results.push(full);
      }
    }
  }
  return results;
}
async function runTestFile(filePath) {
  const relPath = path8.relative(process.cwd(), filePath);
  try {
    const result = compileFile(relPath, void 0, { minify: false, write: false });
    const cjsCode = esmToCjs(result.jsCode);
    const testDir = path8.dirname(filePath);
    const testRequire = createTestRequire(testDir);
    const mod = { exports: {} };
    const runFn = new Function("module", "exports", "require", "__dirname", "__filename", "console", "setTimeout", "setInterval", "clearTimeout", "clearInterval", "JSON", "Math", "Date", "Error", "TypeError", "RangeError", "Array", "Object", "String", "Number", "Boolean", "Map", "Set", "Promise", "Symbol", "Buffer", "process", "queueMicrotask", "globalThis", cjsCode);
    runFn(mod, mod.exports, testRequire, testDir, filePath, console, setTimeout, setInterval, clearTimeout, clearInterval, JSON, Math, Date, Error, TypeError, RangeError, Array, Object, String, Number, Boolean, Map, Set, Promise, Symbol, Buffer, process, queueMicrotask, globalThis);
    const testLib = testRequire("@nodeon/test");
    if (testLib && testLib.run) {
      const results = await testLib.run();
      return { file: relPath, results };
    }
    return { file: relPath, results: { passed: 0, failed: 0, skipped: 0, failures: [] } };
  } catch (err) {
    console.error(RED + "  \u2717 " + RESET + relPath + ": " + err.message);
    if (err.stack) {
      const lines = err.stack.split("\n").slice(0, 3);
      for (const line of lines) {
        console.error(DIM + "    " + line + RESET);
      }
    }
    return { file: relPath, results: { passed: 0, failed: 1, skipped: 0, failures: [{ name: relPath, error: err }] } };
  }
}
async function runTest(args) {
  const flags = args.filter((a) => a.startsWith("-"));
  const positional = args.filter((a) => !a.startsWith("-"));
  const pattern = positional[0] || null;
  const watchMode = flags.includes("-w") || flags.includes("--watch");
  console.log("");
  console.log(BOLD + "  Nodeon Test Runner" + RESET);
  console.log("");
  const searchDirs = ["tests", "test", "src", "packages"];
  let testFiles = [];
  for (const dir of searchDirs) {
    const absDir = path8.resolve(process.cwd(), dir);
    const found = findTestFiles(absDir, pattern);
    for (const f of found) {
      testFiles.push(f);
    }
  }
  const rootEntries = fs8.readdirSync(process.cwd(), { withFileTypes: true });
  for (const entry of rootEntries) {
    if (entry.isFile() && entry.name.endsWith(".test.no")) {
      if (!pattern || entry.name.includes(pattern)) {
        testFiles.push(path8.resolve(process.cwd(), entry.name));
      }
    }
  }
  if (testFiles.length === 0) {
    console.log(YELLOW + "  No test files found." + RESET);
    console.log(DIM + "  Looking for *.test.no files in: tests/, test/, src/, packages/" + RESET);
    console.log("");
    return;
  }
  console.log(DIM + "  Found " + testFiles.length + " test file" + testFiles.length > 1 ? "s" : "" + RESET);
  console.log("");
  const startTime = Date.now();
  let totalPassed = 0;
  let totalFailed = 0;
  let totalSkipped = 0;
  for (const file of testFiles) {
    const relFile = path8.relative(process.cwd(), file);
    console.log(CYAN + "  " + relFile + RESET);
    const fileResult = await runTestFile(file);
    if (fileResult.results) {
      totalPassed = totalPassed + fileResult.results.passed;
      totalFailed = totalFailed + fileResult.results.failed;
      totalSkipped = totalSkipped + fileResult.results.skipped;
    }
  }
  const elapsed = Date.now() - startTime;
  console.log("");
  console.log("  " + BOLD + "Results:" + RESET);
  const passLabel = GREEN + totalPassed + " passed" + RESET;
  const failLabel = totalFailed > 0 ? RED + totalFailed + " failed" + RESET : "";
  const skipLabel = totalSkipped > 0 ? YELLOW + totalSkipped + " skipped" + RESET : "";
  const parts = [passLabel, failLabel, skipLabel].filter(Boolean);
  const total = totalPassed + totalFailed + totalSkipped;
  console.log("  Tests: " + parts.join(", ") + " (" + total + " total)");
  console.log("  Files: " + testFiles.length);
  const elapsedSec = elapsed / 1e3;
  console.log("  Time:  " + elapsedSec.toFixed(2) + "s");
  console.log("");
  if (totalFailed > 0) {
    process.exit(1);
  }
}

// dist/cli/commands/new.js
var fs9 = require("fs");
var path9 = require("path");
var readline2 = require("readline");
function ask(rl, question) {
  return new Promise((resolve2) => {
    rl.question(question, (answer) => {
      resolve2(answer.trim());
    });
  });
}
function askChoice(rl, question, options) {
  return new Promise((resolve2) => {
    console.log(question);
    let i = 0;
    while (i < options.length) {
      console.log("  " + CYAN + i + 1 + RESET + ") " + options[i].label + options[i].default ? " " + DIM + "(default)" + RESET : "");
      i = i + 1;
    }
    rl.question("  > ", (answer) => {
      const idx = parseInt(answer) - 1;
      if (idx >= 0 && idx < options.length) {
        resolve2(options[idx].value);
      } else {
        const def = options.find((o) => o.default);
        resolve2(def ? def.value : options[0].value);
      }
    });
  });
}
function writeFile(filePath, content) {
  fs9.mkdirSync(path9.dirname(filePath), { recursive: true });
  fs9.writeFileSync(filePath, content, "utf8");
}
function generateNodeonJson(name, projectType, dbChoice) {
  const config = { name, version: "0.1.0", type: "workspace" };
  if (projectType === "fullstack" || projectType === "api") {
    config.workspace = { apps: ["apps/*"], packages: ["packages/*"] };
  }
  config.compiler = { strict: true, sourceMap: true, target: "node20" };
  if (projectType === "fullstack" || projectType === "api") {
    config.paths = { "@shared/*": ["packages/shared/src/*"], "@db/*": ["packages/db/src/*"] };
    if (dbChoice !== "none") {
      config.db = { driver: dbChoice, url: "${DATABASE_URL}", migrations: "packages/db/src/migrations", models: "packages/db/src/models", seeds: "packages/db/src/seeds" };
    }
    config.dev = { web: { port: 3e3 }, api: { port: 3001 } };
  }
  config.test = { include: ["tests/**/*.test.no"] };
  return JSON.stringify(config, null, 2);
}
function generatePackageJson(name) {
  return JSON.stringify({ name, version: "0.1.0", private: true, workspaces: ["apps/*", "packages/*"] }, null, 2);
}
function generateGitignore() {
  return "node_modules/\ndist/\n.env\n.env.local\n.nodeon-cache/\n*.js.map\n";
}
function generateEnvExample(dbChoice) {
  let env = "NODE_ENV=development\nPORT=3000\nAPI_PORT=3001\n";
  if (dbChoice === "postgresql") {
    env = env + "\nDATABASE_URL=postgresql://nodeon:nodeon@localhost:5432/myapp\nDB_NAME=myapp\nDB_USER=nodeon\nDB_PASSWORD=nodeon\n";
  }
  if (dbChoice === "sqlite") {
    env = env + "\nDATABASE_URL=./data/app.db\n";
  }
  env = env + "\nSESSION_SECRET=change-me-in-production\n";
  return env;
}
function generateReadme(name) {
  return "# " + name + "\n\nBuilt with [Nodeon](https://github.com/isma-is-dev/Nodeon) + Nova framework.\n\n## Getting Started\n\n```bash\nnodeon dev\n```\n\n## Commands\n\n| Command | Description |\n|---------|-------------|\n| `nodeon dev` | Start development server |\n| `nodeon build` | Production build |\n| `nodeon test` | Run tests |\n| `nodeon generate entity <name>` | Generate a new entity |\n| `nodeon generate page <path>` | Generate a new page |\n";
}
function scaffoldFullstack(projectDir, name, dbChoice) {
  writeFile(path9.join(projectDir, "nodeon.json"), generateNodeonJson(name, "fullstack", dbChoice));
  writeFile(path9.join(projectDir, "package.json"), generatePackageJson(name));
  writeFile(path9.join(projectDir, ".gitignore"), generateGitignore());
  writeFile(path9.join(projectDir, ".env.example"), generateEnvExample(dbChoice));
  writeFile(path9.join(projectDir, "README.md"), generateReadme(name));
  writeFile(path9.join(projectDir, "apps", "web", "src", "pages", "index.no"), 'export fn load() {\n  return { title: "Welcome to ' + name + '" }\n}\n\nexport fn template(data) {\n  return "<h1>" + data.title + "</h1>\\n<p>Edit apps/web/src/pages/index.no to get started.</p>"\n}\n');
  writeFile(path9.join(projectDir, "apps", "web", "src", "pages", "about.no"), 'export fn template() {\n  return "<h1>About</h1>\\n<p>Built with Nodeon + Nova.</p>"\n}\n');
  writeFile(path9.join(projectDir, "apps", "web", "src", "components", "Header.no"), 'export fn template(props) {\n  return "<header><nav><a href=\\"/\\">Home</a> | <a href=\\"/about\\">About</a></nav></header>"\n}\n');
  writeFile(path9.join(projectDir, "apps", "web", "src", "layouts", "Main.no"), 'import { Header } from "../components/Header.no"\n\nexport fn template(props) {\n  return "<html><head><title>" + (props.title ?? "' + name + '") + "</title></head><body>" + Header.template() + "<main>" + props.content + "</main></body></html>"\n}\n');
  writeFile(path9.join(projectDir, "apps", "api", "src", "main.no"), 'const http = require("http")\n\nconst PORT = process.env.API_PORT ?? 3001\n\nconst server = http.createServer((req, res) => {\n  res.writeHead(200, { "Content-Type": "application/json" })\n  res.end(JSON.stringify({ status: "ok", message: "' + name + ' API running" }))\n})\n\nserver.listen(PORT, () => {\n  print("API server running on http://localhost:" + PORT)\n})\n');
  writeFile(path9.join(projectDir, "apps", "api", "src", "routes", "health.no"), 'export fn handler(req, res) {\n  return { status: "ok", timestamp: new Date().toISOString() }\n}\n');
  writeFile(path9.join(projectDir, "packages", "shared", "src", "index.no"), '// Shared types and validation\nexport { AppConfig } from "./types/config.no"\n');
  writeFile(path9.join(projectDir, "packages", "shared", "src", "types", "config.no"), '// Application configuration type\nexport const AppConfig = {\n  name: "' + name + '",\n  version: "0.1.0"\n}\n');
  if (dbChoice !== "none") {
    writeFile(path9.join(projectDir, "packages", "db", "src", "index.no"), '// Database client\nconst dbUrl = process.env.DATABASE_URL ?? ""\n\nexport fn getDatabase() {\n  print("Database URL: " + dbUrl)\n  return { url: dbUrl }\n}\n');
    writeFile(path9.join(projectDir, "packages", "db", "src", "migrations", ".gitkeep"), "");
    writeFile(path9.join(projectDir, "packages", "db", "src", "models", ".gitkeep"), "");
    writeFile(path9.join(projectDir, "packages", "db", "src", "seeds", ".gitkeep"), "");
  }
  writeFile(path9.join(projectDir, "tests", "example.test.no"), 'import { describe, it, expect } from "@nodeon/test"\n\ndescribe("Example", fn() {\n  it("should pass a basic assertion", fn() {\n    expect(1 + 1).toBe(2)\n  })\n\n  it("should check strings", fn() {\n    expect("hello").toContain("ell")\n  })\n\n  it("should check arrays", fn() {\n    expect([1, 2, 3]).toHaveLength(3)\n  })\n})\n');
  if (dbChoice === "postgresql") {
    writeFile(path9.join(projectDir, "infra", "docker", "docker-compose.yml"), 'services:\n  db:\n    image: postgres:16-alpine\n    environment:\n      POSTGRES_DB: ${DB_NAME:-myapp}\n      POSTGRES_USER: ${DB_USER:-nodeon}\n      POSTGRES_PASSWORD: ${DB_PASSWORD:-nodeon}\n    ports:\n      - "5432:5432"\n    volumes:\n      - pgdata:/var/lib/postgresql/data\n\nvolumes:\n  pgdata:\n');
  }
}
function scaffoldApi(projectDir, name, dbChoice) {
  writeFile(path9.join(projectDir, "nodeon.json"), generateNodeonJson(name, "api", dbChoice));
  writeFile(path9.join(projectDir, "package.json"), generatePackageJson(name));
  writeFile(path9.join(projectDir, ".gitignore"), generateGitignore());
  writeFile(path9.join(projectDir, ".env.example"), generateEnvExample(dbChoice));
  writeFile(path9.join(projectDir, "README.md"), generateReadme(name));
  writeFile(path9.join(projectDir, "src", "main.no"), 'const http = require("http")\n\nconst PORT = process.env.PORT ?? 3000\n\nconst server = http.createServer((req, res) => {\n  res.writeHead(200, { "Content-Type": "application/json" })\n  res.end(JSON.stringify({ status: "ok", message: "' + name + ' API running" }))\n})\n\nserver.listen(PORT, () => {\n  print("Server running on http://localhost:" + PORT)\n})\n');
  writeFile(path9.join(projectDir, "tests", "example.test.no"), 'import { describe, it, expect } from "@nodeon/test"\n\ndescribe("Example", fn() {\n  it("should work", fn() {\n    expect(true).toBeTruthy()\n  })\n})\n');
}
function scaffoldLibrary(projectDir, name) {
  const config = { name, version: "0.1.0", type: "library", compiler: { strict: true, sourceMap: true }, test: { include: ["tests/**/*.test.no"] } };
  writeFile(path9.join(projectDir, "nodeon.json"), JSON.stringify(config, null, 2));
  writeFile(path9.join(projectDir, "package.json"), JSON.stringify({ name, version: "0.1.0", main: "dist/index.js", files: ["dist/**/*"] }, null, 2));
  writeFile(path9.join(projectDir, ".gitignore"), generateGitignore());
  writeFile(path9.join(projectDir, "README.md"), "# " + name + "\n\nA Nodeon library.\n");
  writeFile(path9.join(projectDir, "src", "index.no"), "// " + name + ' \u2014 main entry point\n\nexport fn hello(name) {\n  return "Hello, " + name + "!"\n}\n');
  writeFile(path9.join(projectDir, "tests", "index.test.no"), 'import { describe, it, expect } from "@nodeon/test"\nimport { hello } from "../src/index.no"\n\ndescribe("' + name + '", fn() {\n  it("greets by name", fn() {\n    expect(hello("World")).toBe("Hello, World!")\n  })\n})\n');
}
function scaffoldCli(projectDir, name) {
  const config = { name, version: "0.1.0", type: "cli", entry: "src/main.no", compiler: { strict: true, sourceMap: true } };
  writeFile(path9.join(projectDir, "nodeon.json"), JSON.stringify(config, null, 2));
  writeFile(path9.join(projectDir, "package.json"), JSON.stringify({ name, version: "0.1.0", bin: { [name]: "./dist/main.js" }, files: ["dist/**/*"] }, null, 2));
  writeFile(path9.join(projectDir, ".gitignore"), generateGitignore());
  writeFile(path9.join(projectDir, "README.md"), "# " + name + "\n\nA CLI tool built with Nodeon.\n");
  writeFile(path9.join(projectDir, "src", "main.no"), 'const args = process.argv.slice(2)\nconst cmd = args[0]\n\nif !cmd || cmd == "help" {\n  print("Usage: ' + name + ' <command>")\n  print("Commands: greet, version, help")\n} else {\n  if cmd == "version" {\n    print("' + name + ' v0.1.0")\n  } else {\n    if cmd == "greet" {\n      const name = args[1] ?? "World"\n      print("Hello, " + name + "!")\n    } else {\n      print("Unknown command: " + cmd)\n      process.exit(1)\n    }\n  }\n}\n');
}
async function runNew(args) {
  const nameArg = args.filter((a) => !a.startsWith("-"))[0];
  const nonInteractive = args.includes("--yes") || args.includes("-y");
  console.log("");
  console.log(BOLD + "  Nodeon" + RESET + " \u2014 Create New Project");
  console.log("");
  const rl = readline2.createInterface({ input: process.stdin, output: process.stdout });
  let name = nameArg;
  if (!name) {
    name = await ask(rl, "  Project name: ");
  }
  if (!name) {
    console.error(RED + "  Project name is required." + RESET);
    rl.close();
    process.exit(1);
  }
  if (!/^[a-zA-Z][\w-]*$/.test(name)) {
    console.error(RED + "  Invalid project name. Use letters, numbers, hyphens only." + RESET);
    rl.close();
    process.exit(1);
  }
  let projectType = "fullstack";
  let dbChoice = "postgresql";
  if (!nonInteractive) {
    console.log("");
    projectType = await askChoice(rl, "  What kind of project?", [{ label: "Full-stack web app (Nova)", value: "fullstack", default: true }, { label: "API only (backend)", value: "api" }, { label: "Library (npm package)", value: "library" }, { label: "CLI tool", value: "cli" }]);
    if (projectType === "fullstack" || projectType === "api") {
      console.log("");
      dbChoice = await askChoice(rl, "  Database?", [{ label: "PostgreSQL", value: "postgresql", default: true }, { label: "SQLite", value: "sqlite" }, { label: "None", value: "none" }]);
    }
  }
  rl.close();
  const projectDir = path9.resolve(process.cwd(), name);
  if (fs9.existsSync(projectDir)) {
    console.error(RED + "  Directory '" + name + "' already exists." + RESET);
    process.exit(1);
  }
  console.log("");
  console.log(DIM + "  Creating project..." + RESET);
  if (projectType === "fullstack") {
    scaffoldFullstack(projectDir, name, dbChoice);
  } else if (projectType === "api") {
    scaffoldApi(projectDir, name, dbChoice);
  } else if (projectType === "library") {
    scaffoldLibrary(projectDir, name);
  } else {
    scaffoldCli(projectDir, name);
  }
  console.log("");
  console.log(GREEN + "  \u2713" + RESET + " Project " + BOLD + name + RESET + " created!");
  console.log("");
  function listDir(dir, prefix) {
    const entries = fs9.readdirSync(dir, { withFileTypes: true }).sort((a, b) => {
      if (a.isDirectory() && !b.isDirectory()) {
        return -1;
      }
      if (!a.isDirectory() && b.isDirectory()) {
        return 1;
      }
      return a.name.localeCompare(b.name);
    });
    let idx = 0;
    while (idx < entries.length) {
      const entry = entries[idx];
      const isLast = idx === entries.length - 1;
      const connector = isLast ? "\u2514\u2500\u2500 " : "\u251C\u2500\u2500 ";
      const childPrefix = isLast ? "    " : "\u2502   ";
      if (entry.isDirectory()) {
        console.log(DIM + "  " + prefix + connector + RESET + CYAN + entry.name + "/" + RESET);
        listDir(path9.join(dir, entry.name), prefix + childPrefix);
      } else {
        console.log(DIM + "  " + prefix + connector + RESET + entry.name);
      }
      idx = idx + 1;
    }
  }
  listDir(projectDir, "");
  console.log("");
  console.log("  Next steps:");
  console.log("    " + CYAN + "cd " + name + RESET);
  if (projectType === "fullstack" || projectType === "api") {
    console.log("    " + CYAN + "nodeon dev" + RESET);
  } else {
    console.log("    " + CYAN + "nodeon run src/" + projectType === "cli" ? "main" : "index.no" + RESET);
  }
  console.log("");
}

// dist/cli/commands/generate.js
var fs10 = require("fs");
var path10 = require("path");
function writeFile2(filePath, content) {
  fs10.mkdirSync(path10.dirname(filePath), { recursive: true });
  fs10.writeFileSync(filePath, content, "utf8");
  const rel = path10.relative(process.cwd(), filePath);
  console.log("  " + GREEN + "+" + RESET + " " + rel);
}
function capitalize(str) {
  if (!str || str.length === 0) {
    return str;
  }
  return str[0].toUpperCase() + str.slice(1);
}
function pascalCase(str) {
  return str.split(/[-_]/).map((s) => capitalize(s)).join("");
}
function camelCase(str) {
  const parts = str.split(/[-_]/);
  return parts[0] + parts.slice(1).map((s) => capitalize(s)).join("");
}
function pluralize(str) {
  if (str.endsWith("s")) {
    return str + "es";
  }
  if (str.endsWith("y")) {
    return str.slice(0, -1) + "ies";
  }
  return str + "s";
}
function generateEntity(name) {
  const className = pascalCase(name);
  const tableName = pluralize(name.toLowerCase());
  const varName = camelCase(name);
  console.log("");
  console.log(BOLD + "  Generating entity: " + className + RESET);
  console.log("");
  writeFile2(path10.resolve("packages", "db", "src", "models", name + ".no"), '@entity("' + tableName + '")\nexport class ' + className + " {\n  @id @auto id: number\n  @column name: string\n  @column @nullable description: string\n  @timestamps createdAt: Date\n  @timestamps updatedAt: Date\n}\n");
  const timestamp = Date.now();
  const migrationNum = String(timestamp).slice(-6);
  writeFile2(path10.resolve("packages", "db", "src", "migrations", migrationNum + "_create_" + tableName + ".no"), 'import { Migration } from "@nodeon/db"\n\nexport class Create' + capitalize(tableName) + ' extends Migration {\n  async fn up(db) {\n    await db.createTable("' + tableName + '", fn(t) {\n      t.id()\n      t.string("name")\n      t.string("description").nullable()\n      t.timestamps()\n    })\n  }\n\n  async fn down(db) {\n    await db.dropTable("' + tableName + '")\n  }\n}\n');
  writeFile2(path10.resolve("packages", "shared", "src", "types", name + ".no"), "export type " + className + " = {\n  id: number\n  name: string\n  description: string | null\n  createdAt: Date\n  updatedAt: Date\n}\n\n@validate\nexport type Create" + className + " = {\n  name: string @minLength(1) @maxLength(255)\n  description: string | null\n}\n\n@validate\nexport type Update" + className + " = {\n  name: string @minLength(1) @maxLength(255)\n  description: string | null\n}\n");
  writeFile2(path10.resolve("apps", "api", "src", "services", name + "-service.no"), "import { " + className + ", Create" + className + ", Update" + className + ' } from "@shared/types/' + name + '"\n\n@service\nexport class ' + className + "Service {\n  @inject db: Database\n  @inject log: Logger\n\n  async fn findAll(): " + className + "[] {\n    return await this.db." + varName + ".findMany()\n  }\n\n  async fn findById(id: number): " + className + " | null {\n    return await this.db." + varName + ".findOne(id)\n  }\n\n  async fn create(data: Create" + className + "): " + className + ' {\n    this.log.info("Creating ' + name + '")\n    return await this.db.' + varName + ".create(data)\n  }\n\n  async fn update(id: number, data: Update" + className + "): " + className + " {\n    return await this.db." + varName + ".update(id, data)\n  }\n\n  async fn delete(id: number): boolean {\n    return await this.db." + varName + ".delete(id)\n  }\n}\n");
  writeFile2(path10.resolve("apps", "api", "src", "routes", tableName + ".no"), "import { " + className + 'Service } from "../services/' + name + '-service"\nimport { Create' + className + ", Update" + className + ' } from "@shared/types/' + name + '"\n\n@api("/api/' + tableName + '")\nexport class ' + capitalize(tableName) + "API {\n  @inject " + varName + "s: " + className + 'Service\n\n  @get("/")\n  async fn list() {\n    return await this.' + varName + 's.findAll()\n  }\n\n  @get("/:id")\n  async fn show(@param id: number) {\n    const item = await this.' + varName + 's.findById(id)\n    if !item { throw NotFound("' + className + ' not found") }\n    return item\n  }\n\n  @post("/")\n  async fn create(@body data: Create' + className + ") {\n    return await this." + varName + 's.create(data)\n  }\n\n  @put("/:id")\n  async fn update(@param id: number, @body data: Update' + className + ") {\n    return await this." + varName + 's.update(id, data)\n  }\n\n  @delete("/:id")\n  async fn remove(@param id: number) {\n    await this.' + varName + "s.delete(id)\n    return { ok: true }\n  }\n}\n");
  writeFile2(path10.resolve("tests", "api", "services", name + "-service.test.no"), 'import { describe, it, expect } from "@nodeon/test"\n\ndescribe("' + className + 'Service", fn() {\n  it("should be defined", fn() {\n    expect(true).toBeTruthy()\n  })\n\n  it("findAll returns an array", fn() {\n    // TODO: implement with test database\n    expect([]).toBeArray()\n  })\n})\n');
  console.log("");
  console.log(DIM + "  Generated 6 files for entity '" + name + "'." + RESET);
  console.log(DIM + "  Run 'nodeon db migrate' to create the database table." + RESET);
  console.log("");
}
function generatePage(pagePath) {
  const parts = pagePath.split("/");
  const fileName = parts[parts.length - 1];
  const className = pascalCase(fileName.replace(/\[|\]/g, ""));
  console.log("");
  console.log(BOLD + "  Generating page: " + pagePath + RESET);
  console.log("");
  const hasDynamicParam = fileName.includes("[");
  const paramName = hasDynamicParam ? fileName.replace(/\[|\]/g, "").replace(".no", "") : null;
  let loadFn = "";
  if (hasDynamicParam) {
    loadFn = "\n  async fn load(params) {\n    // TODO: fetch data using params." + paramName + "\n    return { " + paramName + ": params." + paramName + " }\n  }\n";
  } else {
    loadFn = '\n  fn load() {\n    return { title: "' + className + '" }\n  }\n';
  }
  writeFile2(path10.resolve("apps", "web", "src", "pages", pagePath + ".no"), "@page\nexport class " + className + " {" + loadFn + '\n  fn template(data) {\n    return "<h1>' + className + '</h1>"\n  }\n}\n');
  console.log("");
}
function generateComponent(name) {
  const className = pascalCase(name);
  console.log("");
  console.log(BOLD + "  Generating component: " + className + RESET);
  console.log("");
  writeFile2(path10.resolve("apps", "web", "src", "components", className + ".no"), "@component\nexport class " + className + ' {\n  @input title: string = ""\n\n  fn template() {\n    return "<div class=\\"' + name.toLowerCase() + '\\">" + this.title + "</div>"\n  }\n\n  fn style() {\n    return ".' + name.toLowerCase() + ' { }"\n  }\n}\n');
  console.log("");
}
function generateIsland(name) {
  const className = pascalCase(name);
  console.log("");
  console.log(BOLD + "  Generating island: " + className + RESET);
  console.log("");
  writeFile2(path10.resolve("apps", "web", "src", "islands", className + ".no"), "@island(idle)\nexport class " + className + ' {\n  @signal count: number = 0\n\n  fn increment() {\n    this.count = this.count + 1\n  }\n\n  fn template() {\n    return "<div class=\\"' + name.toLowerCase() + '\\"><button @click={this.increment}>Count: " + this.count + "</button></div>"\n  }\n}\n');
  console.log("");
}
function generateService(name) {
  const className = pascalCase(name) + "Service";
  console.log("");
  console.log(BOLD + "  Generating service: " + className + RESET);
  console.log("");
  writeFile2(path10.resolve("apps", "api", "src", "services", name + "-service.no"), "@service\nexport class " + className + ' {\n  @inject log: Logger\n\n  async fn execute(data) {\n    this.log.info("' + className + '.execute called")\n    // TODO: implement business logic\n    return data\n  }\n}\n');
  writeFile2(path10.resolve("tests", "api", "services", name + "-service.test.no"), 'import { describe, it, expect } from "@nodeon/test"\n\ndescribe("' + className + '", fn() {\n  it("should be defined", fn() {\n    expect(true).toBeTruthy()\n  })\n})\n');
  console.log("");
}
function generateMiddleware(name) {
  const className = pascalCase(name) + "Middleware";
  console.log("");
  console.log(BOLD + "  Generating middleware: " + className + RESET);
  console.log("");
  writeFile2(path10.resolve("apps", "api", "src", "middleware", name + ".no"), "@middleware\nexport class " + className + ' {\n  @inject log: Logger\n\n  async fn handle(req, next) {\n    this.log.debug("' + className + ' processing request")\n    const response = await next()\n    return response\n  }\n}\n');
  console.log("");
}
function generateJob(name) {
  const className = pascalCase(name);
  console.log("");
  console.log(BOLD + "  Generating job: " + className + RESET);
  console.log("");
  writeFile2(path10.resolve("apps", "api", "src", "jobs", name + ".no"), "@job\nexport class " + className + ' {\n  @inject log: Logger\n\n  async fn execute(payload) {\n    this.log.info("Job ' + className + ' started")\n    // TODO: implement job logic\n    this.log.info("Job ' + className + ' completed")\n  }\n}\n');
  console.log("");
}
function generateModule(name) {
  console.log("");
  console.log(BOLD + "  Generating module: " + name + RESET);
  console.log("");
  generateEntity(name);
  writeFile2(path10.resolve("apps", "web", "src", "pages", pluralize(name), "index.no"), "@page\nexport class " + pascalCase(pluralize(name)) + "List {\n  async fn load() {\n    // TODO: fetch " + pluralize(name) + ' from API\n    return { items: [] }\n  }\n\n  fn template(data) {\n    return "<h1>' + capitalize(pluralize(name)) + '</h1>\\n<ul>" + data.items.map((item) => "<li>" + item.name + "</li>").join("") + "</ul>"\n  }\n}\n');
  writeFile2(path10.resolve("apps", "web", "src", "pages", pluralize(name), "[id].no"), "@page\nexport class " + pascalCase(name) + "Detail {\n  async fn load(params) {\n    // TODO: fetch " + name + ' by id from API\n    return { item: { id: params.id, name: "' + capitalize(name) + ' " + params.id } }\n  }\n\n  fn template(data) {\n    return "<h1>" + data.item.name + "</h1>"\n  }\n}\n');
  console.log(DIM + "  Generated complete module '" + name + "'." + RESET);
  console.log("");
}
function printGenerateHelp() {
  console.log("");
  console.log(BOLD + "  nodeon generate" + RESET + " \u2014 Code scaffolding");
  console.log("");
  console.log("  Usage: nodeon generate <type> <name>");
  console.log("  Alias: nodeon g <type> <name>");
  console.log("");
  console.log("  Types:");
  console.log("    " + CYAN + "entity" + RESET + " <name>      Model + migration + service + API + tests");
  console.log("    " + CYAN + "page" + RESET + " <path>        Page component with load function");
  console.log("    " + CYAN + "component" + RESET + " <name>   Server component (zero JS)");
  console.log("    " + CYAN + "island" + RESET + " <name>      Interactive island component");
  console.log("    " + CYAN + "service" + RESET + " <name>     Injectable service");
  console.log("    " + CYAN + "middleware" + RESET + " <name>   Request middleware");
  console.log("    " + CYAN + "job" + RESET + " <name>         Background job");
  console.log("    " + CYAN + "module" + RESET + " <name>      Full module (entity + service + API + pages + tests)");
  console.log("");
}
function runGenerate(args) {
  const genType = args[0];
  const genName = args[1];
  if (!genType) {
    printGenerateHelp();
    return;
  }
  if (!genName) {
    console.error(RED + "  Missing name. Usage: nodeon generate " + genType + " <name>" + RESET);
    process.exit(1);
  }
  if (genType === "entity") {
    generateEntity(genName);
  } else if (genType === "page") {
    generatePage(genName);
  } else if (genType === "component") {
    generateComponent(genName);
  } else if (genType === "island") {
    generateIsland(genName);
  } else if (genType === "service") {
    generateService(genName);
  } else if (genType === "middleware") {
    generateMiddleware(genName);
  } else if (genType === "job") {
    generateJob(genName);
  } else if (genType === "module") {
    generateModule(genName);
  } else {
    console.error(RED + "  Unknown generator type: " + genType + RESET);
    printGenerateHelp();
    process.exit(1);
  }
}

// dist/cli/commands/dev.js
var fs11 = require("fs");
var path11 = require("path");
var http = require("http");
function loadConfig2() {
  const configPath = path11.resolve(process.cwd(), "nodeon.json");
  if (!fs11.existsSync(configPath)) {
    return {};
  }
  try {
    return JSON.parse(fs11.readFileSync(configPath, "utf8"));
  } catch (e) {
    return {};
  }
}
var MIME_TYPES = { ".html": "text/html", ".css": "text/css", ".js": "application/javascript", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf", ".wasm": "application/wasm" };
function compileAndRun(filePath) {
  const source = fs11.readFileSync(filePath, "utf8");
  const compiler = require(path11.resolve(process.cwd(), "dist", "nodeon-compiler.cjs"));
  const result = compiler.compile(source);
  if (result.diagnostics.length > 0) {
    for (const diag of result.diagnostics) {
      console.error("  " + RED + "error" + RESET + ": " + diag.message);
    }
    return null;
  }
  const vm4 = require("vm");
  const mod = { exports: {} };
  let code2 = result.js;
  code2 = code2.replace(/import\s+\{([^}]+)\}\s+from\s+["']([^"']+)["'];?/g, 'const {$1} = require("$2");');
  code2 = code2.replace(/import\s+(\w+)\s+from\s+["']([^"']+)["'];?/g, 'const $1 = require("$2");');
  code2 = code2.replace(/export\s+(class|function|const|let|var)\s+/g, "$1 ");
  code2 = code2.replace(/export\s+default\s+/g, "module.exports.default = ");
  const exportPattern = /(?:class|function)\s+(\w+)/g;
  let matched = exportPattern.exec(result.js);
  const namedExports = [];
  while (matched !== null) {
    if (result.js.includes("export " + matched[0].trim().split(" ")[0]) || result.js.includes("export " + matched[0])) {
      namedExports.push(matched[1]);
    }
    matched = exportPattern.exec(result.js);
  }
  for (const name of namedExports) {
    code2 = code2 + "\nmodule.exports." + name + " = typeof " + name + " !== 'undefined' ? " + name + " : undefined;";
  }
  try {
    const script = new vm4.Script(code2, { filename: filePath });
    const sandbox = { module: mod, exports: mod.exports, require, __filename: filePath, __dirname: path11.dirname(filePath), console, process, Buffer, setTimeout, setInterval, clearTimeout, clearInterval, URL, URLSearchParams };
    script.runInNewContext(sandbox);
    return mod.exports;
  } catch (err) {
    console.error("  " + RED + "error" + RESET + " executing " + filePath + ": " + err.message);
    return null;
  }
}
function buildRoutes(pagesDir) {
  const routes = [];
  if (!fs11.existsSync(pagesDir)) {
    return routes;
  }
  function scan(dir, prefix) {
    const entries = fs11.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path11.join(dir, entry.name);
      if (entry.isDirectory()) {
        scan(full, prefix + "/" + entry.name);
      } else {
        if (!entry.name.endsWith(".no") && !entry.name.endsWith(".js")) {
          continue;
        }
        const ext = path11.extname(entry.name);
        const base = entry.name.slice(0, 0 - ext.length);
        const segment = base === "index" ? "" : "/" + base;
        const urlPath = prefix + segment || "/";
        const paramNames = [];
        const pattern = urlPath.replace(/\[([^\]]+)\]/g, (_, name) => {
          paramNames.push(name);
          return ":(" + name + ")";
        });
        const regexStr = "^" + pattern.replace(/:\(([^)]+)\)/g, "([^/]+)").replace(/\//g, "\\/") + "$";
        routes.push({ pattern: urlPath, regex: new RegExp(regexStr), paramNames, filePath: full, isDynamic: paramNames.length > 0, isApi: urlPath.startsWith("/api/") || urlPath.startsWith("/api") });
      }
    }
  }
  scan(pagesDir, "");
  routes.sort((a, b) => {
    if (a.isDynamic !== b.isDynamic) {
      return a.isDynamic ? 1 : -1;
    }
    return a.pattern.localeCompare(b.pattern);
  });
  return routes;
}
function matchRoute(routes, urlPath) {
  const normalized = urlPath === "/" ? "/" : urlPath.replace(/\/$/, "");
  for (const route of routes) {
    const matched = normalized.match(route.regex);
    if (matched) {
      const params = {};
      let i = 0;
      while (i < route.paramNames.length) {
        params[route.paramNames[i]] = matched[i + 1];
        i = i + 1;
      }
      return { route, params };
    }
  }
  return null;
}
function escapeHtml(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function renderErrorPage(err, urlPath) {
  return "<!DOCTYPE html><html><head><title>Nova Error</title><style>body{font-family:system-ui;padding:2rem;background:#1a1a2e;color:#e0e0e0}pre{background:#16213e;padding:1rem;border-radius:8px;overflow-x:auto;border-left:4px solid #e94560}h1{color:#e94560}</style></head><body><h1>Server Error</h1><p>Error rendering <code>" + urlPath + "</code></p><pre>" + escapeHtml(err.stack || err.message) + "</pre></body></html>";
}
function render404(urlPath, routes) {
  const routeList = routes.map((r) => '<li><a href="' + r.pattern + '">' + r.pattern + "</a></li>").join("");
  return "<!DOCTYPE html><html><head><title>404 - Nova</title><style>body{font-family:system-ui;padding:2rem;background:#1a1a2e;color:#e0e0e0}a{color:#00d2ff}h1{color:#e94560}ul{list-style:none;padding:0}li{padding:4px 0}</style></head><body><h1>404 - Not Found</h1><p>No route matches <code>" + urlPath + "</code></p><h2>Available routes:</h2><ul>" + routeList + "</ul></body></html>";
}
function wrapHtmlShell(html, title) {
  if (html.includes("<html") || html.includes("<!DOCTYPE") || html.includes("<!doctype")) {
    return html;
  }
  return '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="UTF-8">\n<meta name="viewport" content="width=device-width, initial-scale=1.0">\n<title>' + (title || "Nova") + "</title>\n</head>\n<body>\n" + html + "\n</body>\n</html>";
}
function injectLiveReload(html, port) {
  const script = '\n<script>(function(){ var es = new EventSource("/__nova_reload"); es.onmessage = function(){ location.reload(); }; })();</script>\n';
  if (html.includes("</body>")) {
    return html.replace("</body>", script + "</body>");
  }
  return html + script;
}
var sseClients = [];
function notifyReload() {
  for (const client of sseClients) {
    try {
      client.write("data: reload\n\n");
    } catch (e) {
    }
  }
}
function runDev(args) {
  const config = loadConfig2();
  const flags = args || [];
  let port = 3e3;
  const portIdx = flags.indexOf("--port");
  if (portIdx !== -1 && flags[portIdx + 1]) {
    port = parseInt(flags[portIdx + 1], 10);
  } else if (config.port) {
    port = config.port;
  }
  const projectDir = process.cwd();
  const pagesDir = path11.join(projectDir, "src", "pages");
  const publicDir = path11.join(projectDir, "public");
  if (!fs11.existsSync(pagesDir)) {
    console.error("");
    console.error("  " + RED + "Error:" + RESET + " No src/pages/ directory found.");
    console.error("  " + DIM + "Run 'nodeon new' to create a project, or create src/pages/ manually." + RESET);
    console.error("");
    process.exit(1);
  }
  let routes = buildRoutes(pagesDir);
  function handleRequest(req, res) {
    const url = new URL(req.url, "http://localhost");
    const urlPath = url.pathname;
    if (urlPath === "/__nova_reload") {
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive", "Access-Control-Allow-Origin": "*" });
      res.write("data: connected\n\n");
      sseClients.push(res);
      req.on("close", () => {
        sseClients = sseClients.filter((c) => c !== res);
      });
      return;
    }
    if (urlPath !== "/" && fs11.existsSync(publicDir)) {
      const staticPath = path11.join(publicDir, urlPath);
      if (fs11.existsSync(staticPath) && fs11.statSync(staticPath).isFile()) {
        const ext = path11.extname(staticPath);
        const mime = MIME_TYPES[ext] || "application/octet-stream";
        res.writeHead(200, { "Content-Type": mime });
        fs11.createReadStream(staticPath).pipe(res);
        return;
      }
    }
    const matched = matchRoute(routes, urlPath);
    if (matched) {
      try {
        const pageMod = compileAndRun(matched.route.filePath);
        if (!pageMod) {
          res.writeHead(500, { "Content-Type": "text/html" });
          res.end(renderErrorPage({ message: "Compilation failed" }, urlPath));
          return;
        }
        if (matched.route.isApi) {
          const handler = pageMod.default || pageMod;
          let result = null;
          if (typeof handler === "function") {
            result = handler(req, res, matched.params);
          } else {
            const method = req.method.toLowerCase();
            const methodName = method === "delete" ? "del" : method;
            if (handler[methodName] && typeof handler[methodName] === "function") {
              result = handler[methodName](req, matched.params);
            } else if (typeof handler === "object") {
              result = handler;
            }
          }
          if (!res.headersSent) {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify(result));
          }
        } else {
          const PageClass = pageMod.default || pageMod;
          let html = "";
          if (typeof PageClass === "function" && PageClass.prototype && PageClass.prototype.template) {
            const instance = new PageClass();
            let data = {};
            if (typeof instance.load === "function") {
              data = instance.load(matched.params) || {};
            }
            html = instance.template(data, matched.params);
            if (typeof instance.style === "function") {
              const css = instance.style();
              if (css) {
                html = "<style>" + css + "</style>" + html;
              }
            }
          } else if (typeof PageClass === "function") {
            html = PageClass(matched.params);
          } else if (typeof PageClass === "string") {
            html = PageClass;
          }
          html = wrapHtmlShell(html, "Nova");
          html = injectLiveReload(html, port);
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(html);
        }
      } catch (err) {
        console.error("  " + RED + "Error rendering " + urlPath + ":" + RESET + " " + err.message);
        res.writeHead(500, { "Content-Type": "text/html" });
        res.end(renderErrorPage(err, urlPath));
      }
      return;
    }
    res.writeHead(404, { "Content-Type": "text/html" });
    res.end(render404(urlPath, routes));
  }
  const server = http.createServer(handleRequest);
  let debounceTimer = null;
  function watchHandler() {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(() => {
      routes = buildRoutes(pagesDir);
      console.log("  " + DIM + "[nova] Routes reloaded (" + routes.length + " routes)" + RESET);
      notifyReload();
    }, 100);
  }
  if (fs11.existsSync(pagesDir)) {
    fs11.watch(pagesDir, { recursive: true }, watchHandler);
  }
  const srcDir = path11.join(projectDir, "src");
  if (fs11.existsSync(srcDir)) {
    fs11.watch(srcDir, { recursive: true }, (eventType, filename) => {
      if (filename && !filename.startsWith("pages")) {
        if (debounceTimer) {
          clearTimeout(debounceTimer);
        }
        debounceTimer = setTimeout(() => {
          console.log("  " + DIM + "[nova] Source changed: " + filename + RESET);
          notifyReload();
        }, 150);
      }
    });
  }
  server.listen(port, () => {
    console.log("");
    console.log("  " + CYAN + BOLD + "\u26A1 Nova dev server" + RESET);
    console.log("");
    console.log("  " + BOLD + "Local:" + RESET + "   http://localhost:" + port);
    console.log("  " + BOLD + "Routes:" + RESET + "  " + routes.length + " pages");
    console.log("");
    for (const route of routes) {
      const tag = route.isApi ? " " + YELLOW + "[API]" + RESET : "";
      const dyn = route.isDynamic ? " " + CYAN + "[dynamic]" + RESET : "";
      console.log("  " + DIM + "\u2192" + RESET + " " + route.pattern + tag + dyn);
    }
    console.log("");
    console.log("  " + DIM + "Watching for changes..." + RESET);
    console.log("");
  });
}

// dist/cli/index.js
async function main(argv) {
  const args = argv ?? process.argv.slice(2);
  const cmd = args[0];
  if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") {
    printHelp();
    return;
  }
  if (cmd === "version" || cmd === "--version" || cmd === "-v") {
    printVersion();
    return;
  }
  if (cmd === "new") {
    await runNew(args.slice(1));
    return;
  }
  if (cmd === "dev") {
    runDev(args.slice(1));
    return;
  }
  if (cmd === "init") {
    runInit(args.slice(1));
    return;
  }
  if (cmd === "build") {
    runBuild(args.slice(1));
    return;
  }
  if (cmd === "run") {
    runRun(args.slice(1));
    return;
  }
  if (cmd === "test") {
    await runTest(args.slice(1));
    return;
  }
  if (cmd === "repl") {
    startRepl();
    return;
  }
  if (cmd === "check") {
    runCheck(args.slice(1));
    return;
  }
  if (cmd === "fmt") {
    runFmt(args.slice(1));
    return;
  }
  if (cmd === "generate" || cmd === "g") {
    runGenerate(args.slice(1));
    return;
  }
  try {
    const resolved = resolveNodeonFile(cmd);
    runRun([resolved, ...args.slice(1)]);
    return;
  } catch (e) {
  }
  const knownCommands = ["build", "run", "repl", "check", "fmt", "help", "version", "init", "new", "test", "generate", "dev"];
  const suggestion = suggestClosest(cmd, knownCommands);
  console.error("Unknown command '" + cmd + "'");
  console.error("See " + CYAN + "'nodeon help'" + RESET + ".");
  if (suggestion) {
    console.error("did you mean: " + suggestion + " ?");
  }
  process.exit(1);
}
if (typeof require !== "undefined" && require.main === module) {
  main();
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  main
});
