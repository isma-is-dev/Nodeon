// Nova Compiler Plugin — hooks into the Nodeon compilation pipeline
// Provides: template pre-compilation, decorator metadata extraction, CSS extraction
import { tokenize, escapeHtml, evalExpr } from "./template.js";

/**
 * Create the Nova compiler plugin.
 * Usage:
 *   import { createNovaPlugin } from "@nova/nova-plugin"
 *   registry.register(createNovaPlugin())
 */
export function createNovaPlugin(opts) {
  const options = opts || {};

  return {
    name: "nova",

    // Extract decorator metadata and inject it into the generated JS
    afterParse(ast, ctx) {
      // Collect decorator info for pages, APIs, islands, services
      const metadata = [];
      for (const stmt of ast.body) {
        if (stmt.type === "ClassDeclaration" && stmt.decorators) {
          for (const dec of stmt.decorators) {
            metadata.push({
              className: stmt.name.name || stmt.name,
              decorator: dec.name,
              args: dec.arguments || [],
            });
          }
        }
      }
      if (metadata.length > 0) {
        ctx.metadata.novaDecorators = metadata;
      }
      return ast;
    },

    // Pre-compile template strings and inject decorator registration
    afterGenerate(js, ctx) {
      let result = js;

      // 1. Pre-compile template() method return strings
      result = precompileTemplates(result);

      // 2. Inject decorator metadata as static properties
      const decorators = ctx.metadata.novaDecorators || [];
      for (const meta of decorators) {
        result = injectDecoratorMetadata(result, meta);
      }

      return result;
    },

    // Resolve @nova/* imports to the Nova package
    resolveImport(specifier) {
      if (specifier.startsWith("@nova/")) {
        const mod = specifier.slice(6);
        return "@nodeon/nova/src/" + mod + ".js";
      }
      return null;
    },
  };
}

/**
 * Pre-compile Nova template strings in generated JS.
 * Finds patterns like:
 *   template(data, params) { return `<div>{{ expr }}</div>`; }
 *   template() { return "<div>{{ expr }}</div>"; }
 * And replaces with pre-compiled render function calls.
 */
function precompileTemplates(js) {
  // Match template method bodies that return a template literal or string
  // Pattern: template(...) { ... return `...`; } or return "...";
  const templateMethodRegex = /template\s*\(([^)]*)\)\s*\{([\s\S]*?)\breturn\s+(["'`])([\s\S]*?)\3\s*;?\s*\}/g;

  return js.replace(templateMethodRegex, (match, params, bodyBefore, quote, templateStr) => {
    // Only process if it contains Nova template syntax
    if (!templateStr.includes("{{") && !templateStr.includes("@if") && !templateStr.includes("@for") && !templateStr.includes("@slot")) {
      return match; // Not a Nova template, leave unchanged
    }

    try {
      const compiled = compileTemplateToJS(templateStr);
      const paramList = params.trim();
      return "template(" + paramList + ") {\n" + bodyBefore + compiled + "\n}";
    } catch (e) {
      // If compilation fails, leave the original
      return match;
    }
  });
}

/**
 * Compile a Nova template string to inline JS render code.
 * This is a build-time version of the runtime compileTemplate().
 */
function compileTemplateToJS(templateStr) {
  const tokens = tokenize(templateStr);
  const ast = parseTokens(tokens);
  const code = emitNodes(ast);
  return '    var __out = "";\n' + code + "\n    return __out;";
}

function parseTokens(tokens) {
  let pos = 0;
  function parseNodes() {
    const nodes = [];
    while (pos < tokens.length) {
      const tok = tokens[pos];
      if (tok.type === "close_brace") { break; }
      if (tok.type === "text") {
        nodes.push({ type: "text", value: tok.value });
        pos++;
      } else if (tok.type === "expr") {
        nodes.push({ type: "expr", value: tok.value });
        pos++;
      } else if (tok.type === "directive") {
        if (tok.name === "if") { nodes.push(parseIf()); }
        else if (tok.name === "for") { nodes.push(parseFor()); }
        else if (tok.name === "slot") { nodes.push({ type: "slot" }); pos++; }
        else if (tok.name === "else") { break; }
        else { nodes.push({ type: "text", value: "@" + tok.name }); pos++; }
      } else if (tok.type === "open_brace") {
        nodes.push({ type: "text", value: "{" });
        pos++;
      } else { pos++; }
    }
    return nodes;
  }
  function skipWs() {
    while (pos < tokens.length && tokens[pos].type === "text" && tokens[pos].value.trim() === "") { pos++; }
  }
  function parseIf() {
    const condition = tokens[pos].arg;
    pos++;
    let body = [];
    skipWs();
    if (pos < tokens.length && tokens[pos].type === "open_brace") {
      pos++;
      body = parseNodes();
      if (pos < tokens.length && tokens[pos].type === "close_brace") { pos++; }
    }
    const elseIfs = [];
    let elseBody = [];
    skipWs();
    while (pos < tokens.length && tokens[pos].type === "directive" && tokens[pos].name === "else") {
      pos++;
      skipWs();
      if (pos < tokens.length && tokens[pos].type === "directive" && tokens[pos].name === "if") {
        const eifCond = tokens[pos].arg;
        pos++;
        skipWs();
        let eifBody = [];
        if (pos < tokens.length && tokens[pos].type === "open_brace") {
          pos++;
          eifBody = parseNodes();
          if (pos < tokens.length && tokens[pos].type === "close_brace") { pos++; }
        }
        elseIfs.push({ condition: eifCond, body: eifBody });
        skipWs();
      } else {
        skipWs();
        if (pos < tokens.length && tokens[pos].type === "open_brace") {
          pos++;
          elseBody = parseNodes();
          if (pos < tokens.length && tokens[pos].type === "close_brace") { pos++; }
        }
        break;
      }
    }
    return { type: "if", condition: condition, body: body, elseIf: elseIfs, elseBody: elseBody };
  }
  function parseFor() {
    const arg = tokens[pos].arg;
    pos++;
    const parts = arg.split(/\s+in\s+/);
    const item = (parts[0] || "item").trim();
    const collection = (parts[1] || "[]").trim();
    let body = [];
    skipWs();
    if (pos < tokens.length && tokens[pos].type === "open_brace") {
      pos++;
      body = parseNodes();
      if (pos < tokens.length && tokens[pos].type === "close_brace") { pos++; }
    }
    return { type: "for", item: item, collection: collection, body: body };
  }
  return parseNodes();
}

function emitNodes(nodes) {
  return nodes.map(emitNode).join("\n");
}

function emitNode(node) {
  switch (node.type) {
    case "text":
      return "    __out += " + JSON.stringify(node.value) + ";";
    case "expr":
      return "    __out += __novaEsc(" + node.value + ");";
    case "slot":
      return '    __out += (slotContent || "");';
    case "if": {
      let code = "    if (" + node.condition + ") {\n";
      code += emitNodes(node.body);
      code += "\n    }";
      for (const eif of node.elseIf) {
        code += " else if (" + eif.condition + ") {\n";
        code += emitNodes(eif.body);
        code += "\n    }";
      }
      if (node.elseBody.length > 0) {
        code += " else {\n";
        code += emitNodes(node.elseBody);
        code += "\n    }";
      }
      return code;
    }
    case "for": {
      const iVar = "__i";
      const cVar = "__col_" + node.item;
      let code = "    var " + cVar + " = " + node.collection + " || [];\n";
      code += "    for (var " + iVar + " = 0; " + iVar + " < " + cVar + ".length; " + iVar + "++) {\n";
      code += "      var " + node.item + " = " + cVar + "[" + iVar + "];\n";
      code += "      var $index = " + iVar + ";\n";
      code += emitNodes(node.body);
      code += "\n    }";
      return code;
    }
    default:
      return "";
  }
}

/**
 * Inject decorator metadata as static class properties.
 * E.g. @page("/about") class AboutPage → AboutPage._page = { path: "/about" };
 */
function injectDecoratorMetadata(js, meta) {
  const className = meta.className;
  const decName = meta.decorator;

  // Build metadata value from decorator arguments
  let metaValue = "true";
  if (meta.args.length > 0) {
    const firstArg = meta.args[0];
    if (firstArg.type === "Literal" || firstArg.type === "StringLiteral") {
      metaValue = JSON.stringify({ path: firstArg.value });
    } else {
      metaValue = "true";
    }
  }

  // Append static property after class definition
  const classEndPattern = new RegExp("(class\\s+" + className + "[\\s\\S]*?\\n\\})");
  if (classEndPattern.test(js)) {
    js = js.replace(classEndPattern, "$1\n" + className + "._" + decName + " = " + metaValue + ";");
  }

  return js;
}

// Nova template escape function (injected into compiled output)
export function __novaEsc(val) {
  if (val === null || val === undefined) { return ""; }
  // Unwrap signals
  if (typeof val === "function" && (val._type === "signal" || val._type === "computed")) {
    val = val();
  }
  var s = String(val);
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
