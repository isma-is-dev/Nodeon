import { Token, TokenType, SourceLocation } from "@language/tokens";
import { KEYWORDS } from "@language/keywords";
import { OPERATORS, TWO_CHAR_OPERATORS, THREE_CHAR_OPERATORS, FOUR_CHAR_OPERATORS } from "@language/operators";
import { DELIMITERS } from "@language/symbols";

/**
 * Optional extra fields attached to `TokenType.Number` tokens.
 *
 * `Token.value` stays a plain string for backward compatibility, but it is now
 * normalised so that `Number(token.value)` yields the correct JavaScript value
 * whenever a Number is representable as a double (numeric separators stripped,
 * legacy octal resolved to decimal).  Consumers that need the exact source text,
 * the radix, or BigInt support must read the fields below instead:
 *
 *   raw          exact source text of the literal, separators and `n` included
 *   bigint       true when the literal has a `n` suffix
 *                → value: BigInt(raw.slice(0, -1))   (raw always ends with `n`)
 *   radix        2 | 8 | 10 | 16
 *   legacyOctal  true for `0777`-style literals; `value` is already base-10
 *   separators   true when the literal used `_` digit separators
 */
export interface NumberExtras {
  raw?: string;
  bigint?: boolean;
  radix?: number;
  legacyOctal?: boolean;
  separators?: boolean;
}

/** Pragmatic (not full UAX#31) identifier classes. */
const IDENT_START_RE = /[\p{L}\p{Nl}$_]/u;
const IDENT_PART_RE = /[\p{L}\p{Nl}\p{Mn}\p{Mc}\p{Nd}\p{Pc}$_]/u;

/** Keywords after which a `(` opens a control-flow header rather than a value. */
const CONTROL_KEYWORDS = new Set(["if", "while", "for", "switch", "catch", "with", "do", "else", "match"]);

/** Keywords that behave like a value for `/` disambiguation. */
const VALUE_KEYWORDS = new Set(["this", "super", "true", "false", "null", "undefined"]);

/** Keywords after which an operand (and therefore a regex) may start. */
const OPERAND_KEYWORDS = new Set([
  "return", "typeof", "instanceof", "in", "of", "new", "delete", "void", "case", "do",
  "else", "yield", "await", "throw", "default", "extends", "as", "satisfies",
]);

/** How a `(` affects what may follow its matching `)`. */
type ParenKind = "control" | "value" | "other";

export class Lexer {
  private src: string;
  private pos = 0;
  private line = 1;
  private column = 1;
  /** Number of characters removed from the front of the source (BOM). */
  private readonly startOffset: number;
  /** One entry per currently open `(`, used to disambiguate regex vs division. */
  private parenKinds: ParenKind[] = [];

  constructor(source: string) {
    // Windows editors (VS Code, Notepad) very often prepend a UTF-8 BOM. It is
    // invisible, is not part of the program, and would otherwise abort lexing at
    // 1:1. It is stripped from the buffer but still counted in `offset` so that
    // positions keep pointing into the real file.
    if (source.length > 0 && source.charCodeAt(0) === 0xfeff) {
      this.src = source.slice(1);
      this.startOffset = 1;
    } else {
      this.src = source;
      this.startOffset = 0;
    }
  }

  tokenize(): Token[] {
    const tokens: Token[] = [];

    while (!this.isAtEnd()) {
      this.skipWhitespaceAndComments();
      if (this.isAtEnd()) break;

      const char = this.peek();
      const loc = this.loc();

      if (this.isIdentStart(char)) {
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
      if (char === "#" && this.pos + 1 < this.src.length && this.isIdentStart(this.src[this.pos + 1])) {
        this.advance(); // skip #
        const ident = this.readIdentifier(loc);
        tokens.push(this.makeToken(TokenType.Identifier, "#" + ident.value, loc));
        continue;
      }

      // Decorator: @name
      if (char === "@" && this.pos + 1 < this.src.length && this.isIdentStart(this.src[this.pos + 1])) {
        this.advance(); // skip @
        const ident = this.readIdentifier(loc);
        tokens.push(this.makeToken(TokenType.Decorator, "@" + ident.value, loc));
        continue;
      }

      // Regex literal: /pattern/flags  (division is decided by isRegexStart, which
      // tracks whether an operand is expected — the previous token alone is not
      // enough, e.g. `if (x) /re/.test(s)` and `f(x) / 2` both end in `)`)
      if (char === "/" && this.isRegexStart(tokens)) {
        const regex = this.tryReadRegExp(loc);
        if (regex) {
          tokens.push(regex);
          continue;
        }
      }

      const opToken = this.readOperatorOrDelimiter(loc);
      if (opToken) {
        this.trackParen(tokens, opToken);
        tokens.push(opToken);
        continue;
      }

      // A character that starts no token. Throwing here aborted the WHOLE
      // file, so one stray character silently emptied the output — including
      // every function around it. Record it, skip the character, and keep
      // lexing so the rest of the program survives and can still be reported.
      this.errors.push(new SyntaxError(`Unexpected character '${char}' at ${this.line}:${this.column}`));
      this.advance();
    }

    tokens.push(this.makeToken(TokenType.EOF, "", this.loc()));
    return tokens;
  }

  /** Lexical errors collected while scanning, in source order. */
  readonly errors: SyntaxError[] = [];

  /** Keeps a stack of `(` kinds so a `)` can be classified later. */
  private trackParen(tokens: Token[], token: Token): void {
    if (token.type !== TokenType.Delimiter) return;
    if (token.value === "(") {
      const prev = tokens[tokens.length - 1];
      let kind: ParenKind = "other";
      if (prev && prev.type === TokenType.Keyword && CONTROL_KEYWORDS.has(prev.value)) {
        kind = "control";
      } else if (
        prev &&
        (prev.type === TokenType.Identifier ||
          (prev.type === TokenType.Delimiter && (prev.value === ")" || prev.value === "]")))
      ) {
        kind = "value";
      }
      this.parenKinds.push(kind);
    } else if (token.value === ")") {
      this.parenKinds.pop();
    }
  }

  private loc(): SourceLocation {
    return { line: this.line, column: this.column, offset: this.pos + this.startOffset };
  }

  private makeToken(type: TokenType, value: string, loc: SourceLocation, extra?: NumberExtras): Token {
    if (!extra) return { type, value, position: loc.offset, loc };
    return { type, value, position: loc.offset, loc, ...extra };
  }

  private readIdentifier(loc: SourceLocation): Token {
    let value = "";
    while (!this.isAtEnd() && this.isIdentPart(this.peek())) {
      value += this.advance();
    }

    const type = KEYWORDS.has(value) ? TokenType.Keyword : TokenType.Identifier;
    return this.makeToken(type, value, loc);
  }

  // ── Numbers ──────────────────────────────────────────────────────────────────
  // Token shape (see NumberExtras):
  //   value  normalised text; `Number(value)` is correct for every
  //          non-BigInt literal (separators removed, legacy octal resolved)
  //   raw    exact source text
  //   bigint true when a `n` suffix is present (value/raw keep the suffix)
  //   radix  2 | 8 | 10 | 16
  //   legacyOctal / separators  informational flags
  private readNumber(loc: SourceLocation): Token {
    const start = this.pos;
    const extras: NumberExtras = {};
    let separators = false;

    // ── Radix-prefixed literals: 0xFF / 0b1010 / 0o17
    if (this.peek() === "0" && this.pos + 1 < this.src.length) {
      const next = this.peekNext();
      const radix = next === "x" || next === "X" ? 16 : next === "b" || next === "B" ? 2 : next === "o" || next === "O" ? 8 : 0;
      if (radix > 0) {
        this.advance(); // 0
        this.advance(); // x | b | o
        separators = this.eatDigits(radix);
        extras.radix = radix;
        // The BigInt suffix must be handled here too, otherwise `0xFFn` would
        // split into `0xFF` + identifier `n` (bug: emitted `let x = 255;\nn;`).
        if (this.peek() === "n" && this.lastCharWasDigit(start, radix)) {
          extras.bigint = true;
          this.advance();
        }
        return this.numberToken(loc, start, extras, separators);
      }
    }

    // ── Integer part (also detects legacy octal such as 0777)
    const intStart = this.pos;
    separators = this.eatDigits(10);
    const intText = this.src.slice(intStart, this.pos);
    const legacyOctal = intText.length > 1 && intText[0] === "0";
    if (legacyOctal) extras.legacyOctal = true;

    // ── Fractional part
    if (this.peek() === "." && (this.isDigit(this.peekNext()) || (this.peekNext() === "_" && this.isDigit(this.peekAt(2))))) {
      this.advance(); // .
      if (this.eatDigits(10)) separators = true;
    }

    // ── Exponent: 1e10, 1.5E-3
    if (this.peek() === "e" || this.peek() === "E") {
      let off = 1;
      if (this.peekAt(1) === "+" || this.peekAt(1) === "-") off = 2;
      const first = this.peekAt(off);
      if (this.isDigit(first) || (first === "_" && this.isDigit(this.peekAt(off + 1)))) {
        this.advance(); // e | E
        if (this.peek() === "+" || this.peek() === "-") this.advance();
        if (this.eatDigits(10)) separators = true;
      }
    }

    // ── BigInt suffix: 123n
    // `1en` / `1e` must not swallow the `n`: a suffix is only valid when the
    // number actually ends on a digit.
    if (this.peek() === "n" && this.lastCharWasDigit(start, legacyOctal ? 8 : 10)) {
      extras.bigint = true;
      this.advance();
    }

    return this.numberToken(loc, start, extras, separators);
  }

  /**
   * Consumes the digits of `radix`, skipping `_` separators between digits.
   * Returns true when at least one separator was consumed.
   */
  private eatDigits(radix: number): boolean {
    let separators = false;
    while (!this.isAtEnd()) {
      const ch = this.peek();
      if (this.isDigitOfRadix(ch, radix)) {
        this.advance();
        continue;
      }
      if (ch === "_" && this.isDigitOfRadix(this.peekNext(), radix)) {
        this.advance();
        separators = true;
        continue;
      }
      break;
    }
    return separators;
  }

  /**
   * Builds the Number token from everything consumed since `start`, normalising
   * the value so that `Number(token.value)` is the correct JavaScript value.
   */
  private numberToken(loc: SourceLocation, start: number, extras: NumberExtras, separators: boolean): Token {
    const raw = this.src.slice(start, this.pos);
    extras.raw = raw;
    if (separators) extras.separators = true;

    if (extras.legacyOctal) {
      // `0777` is legacy octal in JavaScript: 511, not 777. `0779`/`08` contain an
      // 8 or a 9 and are therefore *not* octal — JavaScript reads them as decimal.
      // `intLen` is relative to the start of the literal, not to `src`.
      const intLen = this.legacyOctalLength(start);
      const octal = raw.slice(0, intLen).split("").filter((c) => c !== "_").join("");
      const rest = raw.slice(intLen).split("").filter((c) => c !== "_").join("");
      const allOctal = this.isLegacyOctalDigits(octal);
      if (allOctal) {
        extras.legacyOctal = true;
        extras.radix = 8;
      } else {
        delete extras.legacyOctal; // 0779 / 08 are decimal, not octal
        extras.radix = 10;
      }
      return this.makeToken(
        TokenType.Number,
        (allOctal ? String(parseInt(octal, 8)) : String(parseInt(octal, 10))) + rest,
        loc,
        extras,
      );
    }

    extras.radix = extras.radix ?? 10;
    return this.makeToken(TokenType.Number, raw.split("").filter((c) => c !== "_").join(""), loc, extras);
  }

  /** Length of the leading `0<octal digits>` run that starts at `start`. */
  private legacyOctalLength(start: number): number {
    let i = start + 1;
    while (i < this.src.length && (this.isDigit(this.src[i]) || this.src[i] === "_")) i++;
    return i - start;
  }

  /** True for `0` followed by octal digits only — `0779` and `08` are decimal. */
  private isLegacyOctalDigits(text: string): boolean {
    if (text.length < 2 || text[0] !== "0") return false;
    for (let i = 1; i < text.length; i++) {
      if (!this.isDigitOfRadix(text[i], 8)) return false;
    }
    return true;
  }

  /** True when the last consumed character belongs to this number and is a digit. */
  private lastCharWasDigit(start: number, radix: number): boolean {
    for (let i = this.pos - 1; i >= start; i--) {
      const ch = this.src[i];
      if (ch === "_") continue;
      return this.isDigitOfRadix(ch, radix);
    }
    return false;
  }

  private isDigitOfRadix(ch: string, radix: number): boolean {
    if (ch >= "0" && ch <= "9") return ch.charCodeAt(0) - 48 < radix;
    if (ch >= "a" && ch <= "z") return ch.charCodeAt(0) - 97 < radix - 10;
    if (ch >= "A" && ch <= "Z") return ch.charCodeAt(0) - 65 < radix - 10;
    return false;
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
          case "x": value += this.readHexEscape(); break;
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

      // Pass through ${...} as-is for the parser to handle. The substitution is
      // copied verbatim (the parser re-lexes it), so braces that belong to a
      // string, a nested template or a regex must not be counted.
      if (this.peek() === "$" && this.peekNext() === "{") {
        value += this.advance(); // $
        value += this.advance(); // {
        value += this.readTemplateSubstitution();
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

  /**
   * Consumes a `${ ... }` substitution starting just after the opening `{` and
   * returns its raw source text, including the matching closing `}`.
   *
   * Brace counting alone is not enough: a `}` inside a string, a nested template
   * or a regex character class would close the substitution early and make the
   * whole rest of the file part of the template token. Strings (all three quote
   * kinds, honouring backslash escapes), nested templates and regex literals are
   * therefore skipped over.
   */
  private readTemplateSubstitution(): string {
    let out = "";
    let depth = 1;
    // Whether the next `/` starts a regex (operand expected) or is a division.
    let expectOperand = true;

    while (!this.isAtEnd() && depth > 0) {
      const ch = this.peek();

      if (ch === "\\") {
        out += this.advance();
        if (!this.isAtEnd()) out += this.advance();
        continue;
      }

      if (ch === '"' || ch === "'") {
        out += this.skipQuotedSource(ch);
        expectOperand = false;
        continue;
      }

      if (ch === "`") {
        out += this.skipTemplateSource();
        expectOperand = false;
        continue;
      }

      if (ch === "/" && expectOperand) {
        out += this.skipRegExpSource();
        expectOperand = false;
        continue;
      }

      if (ch === "{" || ch === "(" || ch === "[") {
        if (ch === "{") depth++;
        expectOperand = true;
        out += this.advance();
        continue;
      }

      if (ch === "}") {
        depth--;
        out += this.advance();
        if (depth === 0) return out;
        expectOperand = false;
        continue;
      }

      if (ch === ")" || ch === "]") {
        out += this.advance();
        expectOperand = false;
        continue;
      }

      // Whitespace never changes whether an operand is expected.
      if (this.isWhitespace(ch)) {
        out += this.advance();
        continue;
      }

      if (this.isDigit(ch)) {
        while (!this.isAtEnd() && (this.isIdentPart(this.peek()) || this.peek() === ".")) out += this.advance();
        expectOperand = false;
        continue;
      }

      if (this.isIdentStart(ch)) {
        let word = "";
        while (!this.isAtEnd() && this.isIdentPart(this.peek())) word += this.advance();
        out += word;
        // Keywords such as `return`/`typeof`/`in` are followed by an operand;
        // every other identifier is itself a value (`a / 2` is a division).
        expectOperand = OPERAND_KEYWORDS.has(word);
        continue;
      }

      // Any operator/punctuation: an operand is expected after it.
      out += this.advance();
      expectOperand = true;
    }

    this.error("Unterminated template literal");
  }

  /** Copies a quoted string verbatim, honouring backslash escapes. */
  private skipQuotedSource(quote: string): string {
    let out = this.advance(); // opening quote
    while (!this.isAtEnd()) {
      const ch = this.peek();
      if (ch === "\\") {
        out += this.advance();
        if (!this.isAtEnd()) out += this.advance();
        continue;
      }
      if (this.isLineTerminator(ch)) break; // unterminated: let the parser complain
      out += this.advance();
      if (ch === quote) return out;
    }
    return out;
  }

  /** Copies a nested template literal verbatim, including its substitutions. */
  private skipTemplateSource(): string {
    let out = this.advance(); // opening `
    while (!this.isAtEnd()) {
      const ch = this.peek();
      if (ch === "\\") {
        out += this.advance();
        if (!this.isAtEnd()) out += this.advance();
        continue;
      }
      if (ch === "`") {
        out += this.advance();
        return out;
      }
      if (ch === "$" && this.peekNext() === "{") {
        out += this.advance(); // $
        out += this.advance(); // {
        out += this.readTemplateSubstitution();
        continue;
      }
      out += this.advance();
    }
    return out;
  }

  /** Copies a regex literal verbatim. Regex bodies are not brace-producing. */
  private skipRegExpSource(): string {
    let out = this.advance(); // opening /
    let inCharClass = false;
    while (!this.isAtEnd()) {
      const ch = this.peek();
      if (ch === "\\") {
        out += this.advance();
        if (!this.isAtEnd()) out += this.advance();
        continue;
      }
      if (ch === "[") inCharClass = true;
      if (ch === "]") inCharClass = false;
      if (ch === "/" && !inCharClass) {
        out += this.advance();
        break;
      }
      if (this.isLineTerminator(ch)) break; // not a regex after all
      out += this.advance();
    }
    while (!this.isAtEnd() && this.isRegexFlagChar(this.peek())) out += this.advance();
    return out;
  }

  private readHexEscape(): string {
    let code = "";
    for (let i = 0; i < 2 && !this.isAtEnd() && this.isHexDigit(this.peek()); i++) {
      code += this.advance();
    }
    return String.fromCharCode(parseInt(code, 16));
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

      // ECMAScript whitespace + line terminators, including the invisible
      // separators editors like to insert (NBSP, U+2028, U+2029) and a BOM that
      // is not at position 0.
      if (this.isWhitespace(ch)) {
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
    // Must stop at every line terminator, not just `\n`: with a bare `\r` (old
    // Mac / old Windows file) the comment used to swallow the rest of the file.
    while (!this.isAtEnd() && !this.isLineTerminator(this.peek())) {
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

  /** Identifier start: Unicode letters, `$` and `_` (pragmatic, not full UAX#31). */
  private isIdentStart(ch: string): boolean {
    return ch !== "" && IDENT_START_RE.test(ch);
  }

  /** Identifier continuation: identifier start plus marks, digits and connectors. */
  private isIdentPart(ch: string): boolean {
    return ch !== "" && IDENT_PART_RE.test(ch);
  }

  private isDigit(ch: string): boolean {
    return ch >= "0" && ch <= "9";
  }

  private isHexDigit(ch: string): boolean {
    return this.isDigit(ch) || (ch >= "a" && ch <= "f") || (ch >= "A" && ch <= "F");
  }

  /** ECMAScript WhiteSpace + LineTerminator (includes NBSP, U+2028, U+2029, BOM). */
  private isWhitespace(ch: string): boolean {
    if (ch === "") return false;
    if (ch === " " || ch === "\t" || ch === "\v" || ch === "\f" || this.isLineTerminator(ch)) return true;
    const code = ch.charCodeAt(0);
    if (code === 0x00a0 || code === 0x1680 || code === 0x202f || code === 0x205f || code === 0x3000 || code === 0xfeff) return true;
    return code >= 0x2000 && code <= 0x200a;
  }

  private isLineTerminator(ch: string): boolean {
    return ch === "\n" || ch === "\r" || ch === "\u2028" || ch === "\u2029";
  }

  private isRegexFlagChar(ch: string): boolean {
    return ch === "g" || ch === "i" || ch === "m" || ch === "s" || ch === "u" || ch === "y" || ch === "d" || ch === "n";
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
    if (ch === "\r") {
      // CRLF counts as exactly one line break, and normalises to LF inside
      // string/template values the way JavaScript does.
      if (this.src[this.pos] === "\n") {
        this.pos++;
        this.line++;
        this.column = 1;
        return "\n";
      }
      // A bare CR is a line break too (classic Mac / old Windows files).
      this.line++;
      this.column = 1;
      return ch;
    }
    if (this.isLineTerminator(ch)) {
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
   * Determines whether `/` starts a regex literal or is the division operator,
   * i.e. whether an *operand* is expected at this point.
   *
   * A `/` is division after something that already produced a value. The `)`
   * case needs the paren stack: `f(x) / 2` divides, `if (x) /re/.test(s)` does
   * not. Everything else (operators, `(`, `[`, `{`, `,`, `:`, `;`, keywords such
   * as `return`) is an operand position.
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
    if (prev.type === TokenType.Decorator) return false;
    if (prev.type === TokenType.Delimiter && prev.value === "]") return false;
    if (prev.type === TokenType.Delimiter && prev.value === ")") {
      return this.parenKinds[this.parenKinds.length - 1] === "control";
    }
    if (prev.type === TokenType.Operator && (prev.value === "++" || prev.value === "--")) return false;
    // After keywords that produce values
    if (prev.type === TokenType.Keyword && VALUE_KEYWORDS.has(prev.value)) return false;
    return true;
  }

  /**
   * Reads a regex literal, or gives the `/` back to the operator lexer when the
   * text after it cannot be a regex. `a * / 2` and a bare operator list such as
   * `* / = <` only make sense when `/` is division; a real regex always has a
   * closing `/` on the same line, so backtracking is enough to tell them apart
   * without the old "patterns never start with space/=/ *" guess, which broke
   * `/ a/` and `/=a/`.
   */
  private tryReadRegExp(loc: SourceLocation): Token | null {
    const pos = this.pos;
    const line = this.line;
    const column = this.column;
    try {
      return this.readRegExp(loc);
    } catch {
      this.pos = pos;
      this.line = line;
      this.column = column;
      return null;
    }
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
      // `=`, spaces and `*` are perfectly valid inside a pattern — only a real
      // line terminator means the `/` was division after all.
      if (this.isLineTerminator(ch)) {
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
    while (!this.isAtEnd() && this.isRegexFlagChar(this.peek())) {
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
