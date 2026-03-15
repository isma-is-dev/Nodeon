function tokenize(template) {
  const tokens = [];
  let i = 0;
  const len = template.length;
  while (i < len) {
    if (template[i] === "{" && i + 1 < len && template[i + 1] === "{") {
      i += 2;
      const start = i;
      let depth = 0;
      while (i < len) {
        if (template[i] === "{") {
          depth++;
        } else if (template[i] === "}") {
          if (depth === 0 && i + 1 < len && template[i + 1] === "}") {
            break;
          }
          depth--;
        }
        i++;
      }
      tokens.push({ type: "expr", value: template.slice(start, i).trim() });
      i += 2;
      continue;
    }
    if (template[i] === "@" && /[a-z]/.test(template[i + 1] || "")) {
      const start = i;
      i++;
      let name = "";
      while (i < len && /[a-zA-Z]/.test(template[i])) {
        name += template[i];
        i++;
      }
      if (name === "slot") {
        tokens.push({ type: "directive", name: "slot", arg: "" });
        continue;
      }
      let arg = "";
      while (i < len && template[i] === " ") {
        i++;
      }
      if (template[i] === "(") {
        i++;
        let parenDepth = 1;
        while (i < len && parenDepth > 0) {
          if (template[i] === "(") {
            parenDepth++;
          } else if (template[i] === ")") {
            parenDepth--;
          }
          if (parenDepth > 0) {
            arg += template[i];
          }
          i++;
        }
      }
      tokens.push({ type: "directive", name: name, arg: arg.trim() });
      continue;
    }
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
    let text = "";
    while (i < len) {
      if (template[i] === "{" && i + 1 < len && template[i + 1] === "{") {
        break;
      }
      if (template[i] === "@" && /[a-z]/.test(template[i + 1] || "")) {
        break;
      }
      if (template[i] === "{" || template[i] === "}") {
        break;
      }
      text += template[i];
      i++;
    }
    if (text) {
      tokens.push({ type: "text", value: text });
    }
  }
  return tokens;
}
function parse(tokens) {
  let pos = 0;
  function parseNodes() {
    const nodes = [];
    while (pos < tokens.length) {
      const tok = tokens[pos];
      if (tok.type === "close_brace") {
        break;
      }
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
          break;
        } else {
          nodes.push({ type: "text", value: "@" + tok.name });
          pos++;
        }
      } else if (tok.type === "open_brace") {
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
    const condition = tokens[pos].arg;
    pos++;
    let body = [];
    skipWhitespaceText();
    if (pos < tokens.length && tokens[pos].type === "open_brace") {
      pos++;
      body = parseNodes();
      if (pos < tokens.length && tokens[pos].type === "close_brace") {
        pos++;
      }
    }
    const elseIfs = [];
    let elseBody = [];
    skipWhitespaceText();
    while (pos < tokens.length && tokens[pos].type === "directive" && tokens[pos].name === "else") {
      pos++;
      skipWhitespaceText();
      if (pos < tokens.length && tokens[pos].type === "directive" && tokens[pos].name === "if") {
        const eifCond = tokens[pos].arg;
        pos++;
        let eifBody = [];
        skipWhitespaceText();
        if (pos < tokens.length && tokens[pos].type === "open_brace") {
          pos++;
          eifBody = parseNodes();
          if (pos < tokens.length && tokens[pos].type === "close_brace") {
            pos++;
          }
        }
        elseIfs.push({ condition: eifCond, body: eifBody });
        skipWhitespaceText();
      } else {
        skipWhitespaceText();
        if (pos < tokens.length && tokens[pos].type === "open_brace") {
          pos++;
          elseBody = parseNodes();
          if (pos < tokens.length && tokens[pos].type === "close_brace") {
            pos++;
          }
        }
        break;
      }
    }
    return { type: "if", condition: condition, body: body, elseIf: elseIfs, elseBody: elseBody };
  }
  function parseFor() {
    const arg = tokens[pos].arg;
    pos++;
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
      if (pos < tokens.length && tokens[pos].type === "close_brace") {
        pos++;
      }
    }
    return { type: "for", item: item, collection: collection, body: body };
  }
  return parseNodes();
}
function compileToFunction(ast) {
  const code = compileNodes(ast);
  const body = "\"use strict\";\nvar __out = \"\";\n" + code + "\nreturn __out;\n";
  const ctor = new Function("ctx", "slotContent", body);
  return ctor;
}
function compileNodes(nodes) {
  return nodes.map(compileNode).join("\n");
}
function compileNode(node) {
  switch (node.type) {
    case "text": {
      return "__out += " + JSON.stringify(node.value) + ";";
    }
    case "expr": {
      return "__out += __esc(__eval(ctx, " + JSON.stringify(node.value) + "));";
    }
    case "slot": {
      return "__out += (slotContent || \"\");";
    }
    case "if": {
      let code = "if (__eval(ctx, " + JSON.stringify(node.condition) + `)) {
`;
      code += compileNodes(node.body);
      code += "\n}";
      for (const eif of node.elseIf) {
        code += " else if (__eval(ctx, " + JSON.stringify(eif.condition) + `)) {
`;
        code += compileNodes(eif.body);
        code += "\n}";
      }
      if (node.elseBody.length > 0) {
        code += ` else {
`;
        code += compileNodes(node.elseBody);
        code += "\n}";
      }
      return code;
    }
    case "for": {
      const indexVar = "__i_" + Math.random().toString(36).slice(2, 6);
      const collVar = "__c_" + Math.random().toString(36).slice(2, 6);
      let forCode = "var " + collVar + " = __eval(ctx, " + JSON.stringify(node.collection) + ") || [];\n";
      forCode += "for (var " + indexVar + " = 0; " + indexVar + " < " + collVar + ".length; " + indexVar + `++) {
`;
      forCode += "  var __forCtx = Object.create(ctx);\n";
      forCode += "  __forCtx[\"" + node.item + "\"] = " + collVar + "[" + indexVar + "];\n";
      forCode += "  __forCtx[\"$index\"] = " + indexVar + ";\n";
      forCode += "  var __savedCtx = ctx; ctx = __forCtx;\n";
      forCode += compileNodes(node.body);
      forCode += "\n  ctx = __savedCtx;\n";
      forCode += "}";
      return forCode;
    }
    default: {
      return "";
    }
  }
}
function evalExpr(ctx, expr) {
  try {
    const keys = Object.keys(ctx || {});
    const vals = keys.map(k => {
      return ctx[k];
    });
    const allArgs = keys.concat(["__isSignal", "\"use strict\"; return (" + expr + ");"]);
    const evalFn = Reflect.construct(Function, allArgs);
    vals.push(isSignalFn);
    let result = evalFn.apply(null, vals);
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
function escapeHtml(val) {
  if (val === null || val === undefined) {
    return "";
  }
  const s = String(val);
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function parseTemplate(template) {
  const tokens = tokenize(template);
  return parse(tokens);
}
function compileTemplate(template) {
  const ast = parseTemplate(template);
  const code = compileNodes(ast);
  const fnBody = "\"use strict\";\nvar __out = \"\";\n" + code + "\nreturn __out;\n";
  const wrapperBody = `return function render(ctx, slotContent) {
` + fnBody + "\n};";
  const wrapperFn = new Function("__eval", "__esc", wrapperBody);
  return wrapperFn(evalExpr, escapeHtml);
}
function renderTemplate(template, ctx, slotContent) {
  const render = compileTemplate(template);
  return render(ctx || {}, slotContent);
}
export { parseTemplate, compileTemplate, renderTemplate, tokenize, escapeHtml, evalExpr };