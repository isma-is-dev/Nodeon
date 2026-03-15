import { describe, it, expect } from "vitest";

import { parseTemplate, compileTemplate, renderTemplate, tokenize, escapeHtml, evalExpr } from "../packages/nova/src/template.js";

describe("Nova Template: tokenizer", () => {
  it("tokenizes plain text", () => {
    const tokens = tokenize("hello world");
    expect(tokens).toEqual([{ type: "text", value: "hello world" }]);
  });

  it("tokenizes expression interpolation", () => {
    const tokens = tokenize("hello {{ name }}");
    expect(tokens).toEqual([
      { type: "text", value: "hello " },
      { type: "expr", value: "name" },
    ]);
  });

  it("tokenizes @if directive", () => {
    const tokens = tokenize("@if(x > 0) { yes }");
    expect(tokens[0]).toEqual({ type: "directive", name: "if", arg: "x > 0" });
    // Space between ) and { is a text token
    expect(tokens[1]).toEqual({ type: "text", value: " " });
    expect(tokens[2]).toEqual({ type: "open_brace" });
  });

  it("tokenizes @for directive", () => {
    const tokens = tokenize("@for(item of items) { {{ item }} }");
    expect(tokens[0]).toEqual({ type: "directive", name: "for", arg: "item of items" });
  });

  it("tokenizes @slot", () => {
    const tokens = tokenize("before @slot after");
    expect(tokens[1]).toEqual({ type: "directive", name: "slot", arg: "" });
  });
});

describe("Nova Template: parser", () => {
  it("parses text nodes", () => {
    const ast = parseTemplate("hello");
    expect(ast).toEqual([{ type: "text", value: "hello" }]);
  });

  it("parses expression nodes", () => {
    const ast = parseTemplate("{{ name }}");
    expect(ast).toEqual([{ type: "expr", value: "name" }]);
  });

  it("parses @if with body", () => {
    const ast = parseTemplate("@if(show) { visible }");
    expect(ast[0].type).toBe("if");
    expect(ast[0].condition).toBe("show");
    expect(ast[0].body[0].type).toBe("text");
  });

  it("parses @if/@else", () => {
    const ast = parseTemplate("@if(x) { yes } @else { no }");
    expect(ast[0].type).toBe("if");
    expect(ast[0].body.length).toBeGreaterThan(0);
    expect(ast[0].elseBody.length).toBeGreaterThan(0);
  });

  it("parses @if/@else if/@else", () => {
    const ast = parseTemplate("@if(a) { A } @else @if(b) { B } @else { C }");
    expect(ast[0].type).toBe("if");
    expect(ast[0].elseIf.length).toBe(1);
    expect(ast[0].elseIf[0].condition).toBe("b");
    expect(ast[0].elseBody.length).toBeGreaterThan(0);
  });

  it("parses @for with item and collection", () => {
    const ast = parseTemplate("@for(x of list) { {{ x }} }");
    expect(ast[0].type).toBe("for");
    expect(ast[0].item).toBe("x");
    expect(ast[0].collection).toBe("list");
  });

  it("parses @slot", () => {
    const ast = parseTemplate("@slot");
    expect(ast[0].type).toBe("slot");
  });
});

describe("Nova Template: rendering", () => {
  it("renders plain text", () => {
    expect(renderTemplate("hello world", {})).toBe("hello world");
  });

  it("renders expression interpolation", () => {
    expect(renderTemplate("hello {{ name }}", { name: "Nova" })).toBe("hello Nova");
  });

  it("escapes HTML in expressions", () => {
    expect(renderTemplate("{{ val }}", { val: "<script>alert(1)</script>" }))
      .toBe("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("renders @if true branch", () => {
    expect(renderTemplate("@if(show) { visible }", { show: true })).toBe(" visible ");
  });

  it("renders @if false — no output", () => {
    expect(renderTemplate("@if(show) { visible }", { show: false })).toBe("");
  });

  it("renders @if/@else — else branch", () => {
    expect(renderTemplate("@if(show) { yes } @else { no }", { show: false })).toBe(" no ");
  });

  it("renders @if/@else if/@else", () => {
    expect(renderTemplate(
      "@if(x === 1) { one } @else @if(x === 2) { two } @else { other }",
      { x: 2 }
    )).toBe(" two ");
  });

  it("renders @for loop", () => {
    expect(renderTemplate(
      "@for(item of items) { {{ item }} }",
      { items: ["a", "b", "c"] }
    )).toBe(" a  b  c ");
  });

  it("renders @for with $index", () => {
    expect(renderTemplate(
      "@for(item of items) { {{ $index }}:{{ item }} }",
      { items: ["x", "y"] }
    )).toBe(" 0:x  1:y ");
  });

  it("renders @slot with content", () => {
    expect(renderTemplate("before @slot after", {}, "<main>content</main>"))
      .toBe("before <main>content</main> after");
  });

  it("renders nested expressions with dot access", () => {
    expect(renderTemplate("{{ user.name }}", { user: { name: "Alice" } }))
      .toBe("Alice");
  });

  it("renders arithmetic expressions", () => {
    expect(renderTemplate("{{ a + b }}", { a: 3, b: 4 })).toBe("7");
  });

  it("renders ternary expressions", () => {
    expect(renderTemplate("{{ active ? 'on' : 'off' }}", { active: true }))
      .toBe("on");
  });

  it("handles undefined gracefully", () => {
    expect(renderTemplate("{{ missing }}", {})).toBe("");
  });

  it("renders nested @if inside @for", () => {
    const result = renderTemplate(
      "@for(n of nums) { @if(n > 2) { {{ n }} } }",
      { nums: [1, 2, 3, 4] }
    );
    expect(result).toContain("3");
    expect(result).toContain("4");
    expect(result).not.toContain("1 ");
    expect(result).not.toContain("2 ");
  });
});

describe("Nova Template: compileTemplate", () => {
  it("returns a reusable render function", () => {
    const render = compileTemplate("hello {{ name }}");
    expect(render({ name: "A" })).toBe("hello A");
    expect(render({ name: "B" })).toBe("hello B");
  });

  it("compiled function handles missing ctx gracefully", () => {
    const render = compileTemplate("static");
    expect(render({})).toBe("static");
  });
});

describe("Nova Template: escapeHtml", () => {
  it("escapes all dangerous characters", () => {
    expect(escapeHtml('<div class="x">&')).toBe("&lt;div class=&quot;x&quot;&gt;&amp;");
  });

  it("handles null/undefined", () => {
    expect(escapeHtml(null)).toBe("");
    expect(escapeHtml(undefined)).toBe("");
  });

  it("converts numbers to string", () => {
    expect(escapeHtml(42)).toBe("42");
  });
});
