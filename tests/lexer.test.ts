import { describe, it, expect } from "vitest";
import { Lexer } from "@lexer/lexer";
import { TokenType } from "@language/tokens";

describe("Lexer", () => {
  // ── Helper ───────────────────────────────────────────────
  function tokenize(src: string) {
    return new Lexer(src).tokenize();
  }

  function types(src: string) {
    return tokenize(src).map((t) => t.type);
  }

  function values(src: string) {
    return tokenize(src).map((t) => t.value);
  }

  // ── Basics ───────────────────────────────────────────────
  describe("basic tokens", () => {
    it("tokenizes identifiers", () => {
      const tokens = tokenize("foo bar _baz $el");
      expect(tokens.map((t) => t.value)).toEqual(["foo", "bar", "_baz", "$el", ""]);
    });

    it("tokenizes keywords", () => {
      const tokens = tokenize("fn if else for while return");
      expect(tokens.filter((t) => t.type === TokenType.Keyword).map((t) => t.value))
        .toEqual(["fn", "if", "else", "for", "while", "return"]);
    });

    it("tokenizes new keywords", () => {
      const tokens = tokenize("let const var switch case default break continue do typeof instanceof");
      const kws = tokens.filter((t) => t.type === TokenType.Keyword).map((t) => t.value);
      expect(kws).toEqual(["let", "const", "var", "switch", "case", "default", "break", "continue", "do", "typeof", "instanceof"]);
    });

    it("tokenizes EOF", () => {
      const tokens = tokenize("");
      expect(tokens).toHaveLength(1);
      expect(tokens[0].type).toBe(TokenType.EOF);
    });
  });

  // ── Numbers ──────────────────────────────────────────────
  describe("numbers", () => {
    it("tokenizes integers", () => {
      expect(values("42")).toEqual(["42", ""]);
    });

    it("tokenizes decimals", () => {
      expect(values("3.14")).toEqual(["3.14", ""]);
    });

    it("tokenizes hex literals", () => {
      expect(values("0xFF")).toEqual(["0xFF", ""]);
    });

    it("tokenizes binary literals", () => {
      expect(values("0b1010")).toEqual(["0b1010", ""]);
    });

    it("tokenizes octal literals", () => {
      expect(values("0o77")).toEqual(["0o77", ""]);
    });

    it("tokenizes scientific notation", () => {
      expect(values("1e10")).toEqual(["1e10", ""]);
      expect(values("1.5E-3")).toEqual(["1.5E-3", ""]);
    });

    it("tokenizes BigInt literals", () => {
      expect(values("123n")).toEqual(["123n", ""]);
    });
  });

  // ── Strings ──────────────────────────────────────────────
  describe("strings", () => {
    it("tokenizes double-quoted strings", () => {
      const tokens = tokenize('"hello"');
      expect(tokens[0].type).toBe(TokenType.String);
      expect(tokens[0].value).toBe("hello");
    });

    it("tokenizes single-quoted strings as RawString", () => {
      const tokens = tokenize("'hello'");
      expect(tokens[0].type).toBe(TokenType.RawString);
      expect(tokens[0].value).toBe("hello");
    });

    it("handles escape sequences", () => {
      const tokens = tokenize('"line\\nbreak"');
      expect(tokens[0].value).toBe("line\nbreak");
    });

    it("handles unicode escapes", () => {
      const tokens = tokenize('"\\u0041"');
      expect(tokens[0].value).toBe("A");
    });

    it("throws on unterminated strings", () => {
      expect(() => tokenize('"oops')).toThrow(/Unterminated/);
    });

    it("single-quoted strings preserve braces literally", () => {
      const tokens = tokenize("'{\"ok\": true}'");
      expect(tokens[0].type).toBe(TokenType.RawString);
      expect(tokens[0].value).toContain("{");
    });
  });

  // ── Template Literals ────────────────────────────────────
  describe("template literals", () => {
    it("tokenizes backtick strings", () => {
      const tokens = tokenize("`hello`");
      expect(tokens[0].type).toBe(TokenType.TemplateLiteral);
      expect(tokens[0].value).toBe("hello");
    });

    it("preserves ${} expressions in value", () => {
      const tokens = tokenize("`hello ${name}`");
      expect(tokens[0].type).toBe(TokenType.TemplateLiteral);
      expect(tokens[0].value).toContain("${");
      expect(tokens[0].value).toContain("name");
    });

    it("throws on unterminated template", () => {
      expect(() => tokenize("`oops")).toThrow(/Unterminated/);
    });
  });

  // ── Operators ────────────────────────────────────────────
  describe("operators", () => {
    it("tokenizes single-char operators", () => {
      const tokens = tokenize("+ - * / = < > ! %");
      const ops = tokens.filter((t) => t.type === TokenType.Operator).map((t) => t.value);
      expect(ops).toEqual(["+", "-", "*", "/", "=", "<", ">", "!", "%"]);
    });

    it("tokenizes two-char operators", () => {
      const tokens = tokenize("== != <= >= => && || ?? += -= *= /= ++ -- ** ?.");
      const ops = tokens.filter((t) => t.type === TokenType.Operator).map((t) => t.value);
      expect(ops).toEqual(["==", "!=", "<=", ">=", "=>", "&&", "||", "??", "+=", "-=", "*=", "/=", "++", "--", "**", "?."]);
    });

    it("tokenizes three-char operators", () => {
      const tokens = tokenize("=== !== ... **= &&= ||= ??=");
      const ops = tokens.filter((t) => t.type === TokenType.Operator).map((t) => t.value);
      expect(ops).toEqual(["===", "!==", "...", "**=", "&&=", "||=", "??="]);
    });

    it("tokenizes range operator", () => {
      const tokens = tokenize("0..10");
      expect(values("0..10")).toEqual(["0", "..", "10", ""]);
    });
  });

  // ── Delimiters ───────────────────────────────────────────
  describe("delimiters", () => {
    it("tokenizes all delimiters", () => {
      const tokens = tokenize("( ) { } [ ] , :");
      const delims = tokens.filter((t) => t.type === TokenType.Delimiter).map((t) => t.value);
      expect(delims).toEqual(["(", ")", "{", "}", "[", "]", ",", ":"]);
    });
  });

  // ── Comments ─────────────────────────────────────────────
  describe("comments", () => {
    it("lexes #identifier as private field", () => {
      const tokens = tokenize("#name");
      expect(tokens[0].type).toBe(TokenType.Identifier);
      expect(tokens[0].value).toBe("#name");
    });

    it("skips // comments", () => {
      const tokens = tokenize("x = 1 // comment\ny = 2");
      const ids = tokens.filter((t) => t.type === TokenType.Identifier).map((t) => t.value);
      expect(ids).toEqual(["x", "y"]);
    });

    it("skips /* block comments */", () => {
      const tokens = tokenize("x = /* inline */ 1");
      const ids = tokens.filter((t) => t.type === TokenType.Identifier).map((t) => t.value);
      expect(ids).toEqual(["x"]);
    });

    it("throws on unterminated block comment", () => {
      expect(() => tokenize("/* oops")).toThrow(/Unterminated block comment/);
    });
  });

  // ── Line/Column Tracking ─────────────────────────────────
  describe("source locations", () => {
    it("tracks line and column", () => {
      const tokens = tokenize("x\ny");
      expect(tokens[0].loc).toEqual({ line: 1, column: 1, offset: 0 });
      expect(tokens[1].loc).toEqual({ line: 2, column: 1, offset: 2 });
    });

    it("tracks column within a line", () => {
      const tokens = tokenize("let x = 42");
      // "let" starts at col 1, "x" at col 5, "=" at col 7, "42" at col 9
      expect(tokens[0].loc.column).toBe(1);
      expect(tokens[1].loc.column).toBe(5);
      expect(tokens[2].loc.column).toBe(7);
      expect(tokens[3].loc.column).toBe(9);
    });
  });

  // ── Whitespace ───────────────────────────────────────────
  describe("whitespace handling", () => {
    it("skips spaces, tabs, and newlines", () => {
      const tokens = tokenize("  \t\n  x  ");
      expect(tokens.filter((t) => t.type !== TokenType.EOF)).toHaveLength(1);
    });

    it("handles carriage returns", () => {
      const tokens = tokenize("x\r\ny");
      expect(tokens.filter((t) => t.type !== TokenType.EOF)).toHaveLength(2);
    });
  });

  // ── Error messages ───────────────────────────────────────
  describe("error messages", () => {
    it("includes line:column in syntax errors", () => {
      try {
        tokenize("x\n@");
        expect.fail("Should have thrown");
      } catch (e: any) {
        expect(e.message).toMatch(/2:\d/);
      }
    });
  });
});
