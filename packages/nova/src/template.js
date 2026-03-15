/**
 * Nova Template Engine — Angular-inspired template compilation.
 *
 * Syntax:
 *   {{ expr }}                 — interpolation (auto-reads signals)
 *   @if(cond) { ... }         — conditional block
 *   @else if(cond) { ... }    — else-if
 *   @else { ... }             — else
 *   @for(item of items) { ... } — loop with {{ item }} and {{ $index }}
 *   @slot                     — content projection slot
 *   (event)="handler()"       — event binding (client-side)
 *   [attr]="expr"             — property binding
 *
 * All expressions are evaluated against a context object.
 */

"use strict";

// ── Template AST Nodes ──────────────────────────────────────────

// Text:       { type: "text", value: "..." }
// Expr:       { type: "expr", value: "..." }
// If:         { type: "if", condition: "...", body: [...], elseIf: [...], elseBody: [...] }
// For:        { type: "for", item: "...", collection: "...", body: [...] }
// Slot:       { type: "slot" }
// Element:    { type: "element", tag: "...", attrs: [...], children: [...], events: [...], bindings: [...] }

// ── Tokenizer ───────────────────────────────────────────────────

function tokenize(template) {
  const tokens = [];
  let i = 0;
  const len = template.length;

  while (i < len) {
    // Expression: {{ ... }}
    if (template[i] === "{" && i + 1 < len && template[i + 1] === "{") {
      i += 2;
      const start = i;
      let depth = 0;
      while (i < len) {
        if (template[i] === "{") depth++;
        else if (template[i] === "}") {
          if (depth === 0 && i + 1 < len && template[i + 1] === "}") break;
          depth--;
        }
        i++;
      }
      tokens.push({ type: "expr", value: template.slice(start, i).trim() });
      i += 2; // skip }}
      continue;
    }

    // Directive: @if, @else, @for, @slot
    if (template[i] === "@" && /[a-z]/.test(template[i + 1] || "")) {
      const start = i;
      i++; // skip @
      let name = "";
      while (i < len && /[a-zA-Z]/.test(template[i])) {
        name += template[i];
        i++;
      }

      if (name === "slot") {
        tokens.push({ type: "directive", name: "slot", arg: "" });
        continue;
      }

      // Read condition in parens (if/else if/for)
      let arg = "";
      // skip whitespace
      while (i < len && template[i] === " ") i++;
      if (template[i] === "(") {
        i++; // skip (
        let depth = 1;
        while (i < len && depth > 0) {
          if (template[i] === "(") depth++;
          else if (template[i] === ")") depth--;
          if (depth > 0) arg += template[i];
          i++;
        }
      }

      tokens.push({ type: "directive", name: name, arg: arg.trim() });
      continue;
    }

    // Braces for directive blocks
    if (template[i] === "{") {
      tokens.push({ type: "open_brace" });
      i++;
      continue;
    }
    if (template[i] === "}") {
      tokens.push({ type: "close_brace" });
      i++;
      continue;
    }

    // Plain text
    let text = "";
    while (i < len) {
      if (template[i] === "{" && i + 1 < len && template[i + 1] === "{") break;
      if (template[i] === "@" && /[a-z]/.test(template[i + 1] || "")) break;
      if (template[i] === "{" || template[i] === "}") break;
      text += template[i];
      i++;
    }
    if (text) {
      tokens.push({ type: "text", value: text });
    }
  }

  return tokens;
}

// ── Parser ──────────────────────────────────────────────────────

function parse(tokens) {
  let pos = 0;

  function parseNodes() {
    const nodes = [];
    while (pos < tokens.length) {
      const tok = tokens[pos];
      if (tok.type === "close_brace") break;

      if (tok.type === "text") {
        nodes.push({ type: "text", value: tok.value });
        pos++;
      } else if (tok.type === "expr") {
        nodes.push({ type: "expr", value: tok.value });
        pos++;
      } else if (tok.type === "directive") {
        if (tok.name === "if") {
          nodes.push(parseIf());
        } else if (tok.name === "for") {
          nodes.push(parseFor());
        } else if (tok.name === "slot") {
          nodes.push({ type: "slot" });
          pos++;
        } else if (tok.name === "else") {
          // handled by parseIf
          break;
        } else {
          // Unknown directive — treat as text
          nodes.push({ type: "text", value: "@" + tok.name });
          pos++;
        }
      } else if (tok.type === "open_brace") {
        // Stray brace — treat as text
        nodes.push({ type: "text", value: "{" });
        pos++;
      } else {
        pos++;
      }
    }
    return nodes;
  }

  function skipWhitespaceText() {
    while (pos < tokens.length && tokens[pos].type === "text" && tokens[pos].value.trim() === "") {
      pos++;
    }
  }

  function parseIf() {
    // Current token is @if
    const condition = tokens[pos].arg;
    pos++; // skip @if

    // Expect { ... } (skip whitespace between directive and brace)
    let body = [];
    skipWhitespaceText();
    if (pos < tokens.length && tokens[pos].type === "open_brace") {
      pos++; // skip {
      body = parseNodes();
      if (pos < tokens.length && tokens[pos].type === "close_brace") pos++; // skip }
    }

    // Check for @else if / @else
    const elseIfs = [];
    let elseBody = [];

    skipWhitespaceText();

    while (pos < tokens.length && tokens[pos].type === "directive" && tokens[pos].name === "else") {
      pos++; // skip @else

      // Check if next is @if (else if)
      skipWhitespaceText();

      if (pos < tokens.length && tokens[pos].type === "directive" && tokens[pos].name === "if") {
        const eifCond = tokens[pos].arg;
        pos++; // skip @if

        let eifBody = [];
        skipWhitespaceText();
        if (pos < tokens.length && tokens[pos].type === "open_brace") {
          pos++;
          eifBody = parseNodes();
          if (pos < tokens.length && tokens[pos].type === "close_brace") pos++;
        }
        elseIfs.push({ condition: eifCond, body: eifBody });

        skipWhitespaceText();
      } else {
        // Plain @else
        skipWhitespaceText();
        if (pos < tokens.length && tokens[pos].type === "open_brace") {
          pos++;
          elseBody = parseNodes();
          if (pos < tokens.length && tokens[pos].type === "close_brace") pos++;
        }
        break;
      }
    }

    return { type: "if", condition: condition, body: body, elseIf: elseIfs, elseBody: elseBody };
  }

  function parseFor() {
    const arg = tokens[pos].arg;
    pos++; // skip @for

    // Parse "item of collection"
    const ofIdx = arg.indexOf(" of ");
    let item = arg;
    let collection = "[]";
    if (ofIdx !== -1) {
      item = arg.slice(0, ofIdx).trim();
      collection = arg.slice(ofIdx + 4).trim();
    }

    let body = [];
    skipWhitespaceText();
    if (pos < tokens.length && tokens[pos].type === "open_brace") {
      pos++;
      body = parseNodes();
      if (pos < tokens.length && tokens[pos].type === "close_brace") pos++;
    }

    return { type: "for", item: item, collection: collection, body: body };
  }

  return parseNodes();
}

// ── Compiler (AST → render function) ────────────────────────────

function compileToFunction(ast) {
  const code = compileNodes(ast);
  // The function receives a context object 'ctx' and optional 'slotContent'
  return new Function("ctx", "slotContent", '"use strict";\nvar __out = "";\n' + code + "\nreturn __out;\n");
}

function compileNodes(nodes) {
  return nodes.map(compileNode).join("\n");
}

function compileNode(node) {
  switch (node.type) {
    case "text":
      return '__out += ' + JSON.stringify(node.value) + ';';

    case "expr":
      return '__out += __esc(__eval(ctx, ' + JSON.stringify(node.value) + '));';

    case "slot":
      return '__out += (slotContent || "");';

    case "if": {
      let code = 'if (__eval(ctx, ' + JSON.stringify(node.condition) + ')) {\n';
      code += compileNodes(node.body);
      code += '\n}';
      for (const eif of node.elseIf) {
        code += ' else if (__eval(ctx, ' + JSON.stringify(eif.condition) + ')) {\n';
        code += compileNodes(eif.body);
        code += '\n}';
      }
      if (node.elseBody.length > 0) {
        code += ' else {\n';
        code += compileNodes(node.elseBody);
        code += '\n}';
      }
      return code;
    }

    case "for": {
      const indexVar = "__i_" + Math.random().toString(36).slice(2, 6);
      const collVar = "__c_" + Math.random().toString(36).slice(2, 6);
      let code = 'var ' + collVar + ' = __eval(ctx, ' + JSON.stringify(node.collection) + ') || [];\n';
      code += 'for (var ' + indexVar + ' = 0; ' + indexVar + ' < ' + collVar + '.length; ' + indexVar + '++) {\n';
      code += '  var __forCtx = Object.create(ctx);\n';
      code += '  __forCtx["' + node.item + '"] = ' + collVar + '[' + indexVar + '];\n';
      code += '  __forCtx["$index"] = ' + indexVar + ';\n';
      code += '  var __savedCtx = ctx; ctx = __forCtx;\n';
      code += compileNodes(node.body);
      code += '\n  ctx = __savedCtx;\n';
      code += '}';
      return code;
    }

    default:
      return '';
  }
}

// ── Expression Evaluator ────────────────────────────────────────

function evalExpr(ctx, expr) {
  // Simple dot-path access with function call support
  // Handles: "name", "user.name", "count()", "items.length", "a + b"
  try {
    // Build a with-based evaluator for simple expressions
    const keys = Object.keys(ctx || {});
    const vals = keys.map(function(k) { return ctx[k]; });
    const fn = new Function(...keys, "__isSignal", '"use strict"; return (' + expr + ");");
    vals.push(isSignalFn);
    let result = fn.apply(null, vals);
    // Auto-read signals
    if (typeof result === "function" && result._type === "signal") {
      result = result();
    }
    return result;
  } catch (e) {
    return undefined;
  }
}

function isSignalFn(v) {
  return typeof v === "function" && (v._type === "signal" || v._type === "computed");
}

// ── HTML Escaping ───────────────────────────────────────────────

function escapeHtml(val) {
  if (val == null) return "";
  const s = String(val);
  return s.replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ── Public API ──────────────────────────────────────────────────

/**
 * Compile a template string into an AST.
 * @param {string} template - Template string
 * @returns {object[]} Template AST
 */
function parseTemplate(template) {
  const tokens = tokenize(template);
  return parse(tokens);
}

/**
 * Compile a template string into a render function.
 * @param {string} template - Template string
 * @returns {Function} Render function: (ctx, slotContent?) => string
 */
function compileTemplate(template) {
  const ast = parseTemplate(template);
  // We need to inject __eval and __esc as globals in the function scope
  const code = compileNodes(ast);
  const fnBody = '"use strict";\nvar __out = "";\n' + code + "\nreturn __out;\n";

  // Wrap with __eval and __esc available
  const wrapperFn = new Function("__eval", "__esc",
    "return function render(ctx, slotContent) {\n" + fnBody + "\n};"
  );
  return wrapperFn(evalExpr, escapeHtml);
}

/**
 * Render a template string with context data.
 * @param {string} template - Template string
 * @param {object} ctx - Context data
 * @param {string} [slotContent] - Optional slot content
 * @returns {string} Rendered HTML
 */
function renderTemplate(template, ctx, slotContent) {
  const render = compileTemplate(template);
  return render(ctx || {}, slotContent);
}

module.exports = {
  parseTemplate,
  compileTemplate,
  renderTemplate,
  tokenize,
  // Internal (for testing)
  escapeHtml,
  evalExpr,
};
