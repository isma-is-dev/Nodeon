import fs from "fs";
import path from "path";
import vm from "vm";
let compiler = null;
function getCompiler() {
  if (compiler) {
    return compiler;
  }
  const candidates = [path.resolve(process.cwd(), "dist-no/nodeon-compiler.cjs"), path.resolve(process.cwd(), "../dist-no/nodeon-compiler.cjs"), path.resolve(process.cwd(), "../../dist-no/nodeon-compiler.cjs")];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      const code = fs.readFileSync(candidate, "utf8");
      const mod = { exports: {} };
      const wrapper = new vm.Script("(function(module, exports, require) \\{" + code + "\n\\})", { filename: candidate });
      const ctx = vm.createContext({ require: globalThis.require || () => {
        return {};
      }, process: process, console: console, Buffer: Buffer, __dirname: path.dirname(candidate), __filename: candidate, URL: URL, setTimeout: setTimeout });
      const wrapperFn = wrapper.runInContext(ctx);
      wrapperFn(mod, mod.exports, globalThis.require || () => {
        return {};
      });
      compiler = mod.exports;
      return compiler;
    }
  }
  throw new Error("Nodeon compiler not found. Run 'npm run build' first.");
}
function compileNoFile(filePath) {
  const source = fs.readFileSync(filePath, "utf8");
  const compileResult = getCompiler().compile(source);
  const js = compileResult.js;
  const mod = { exports: {} };
  const sandbox = { module: mod, exports: mod.exports, require: globalThis.require || () => {
    return {};
  }, __filename: filePath, __dirname: path.dirname(filePath), console: console, process: process, Buffer: Buffer, setTimeout: setTimeout, setInterval: setInterval, clearTimeout: clearTimeout, clearInterval: clearInterval };
  let cjsCode = esmToCjs(js);
  try {
    const script = new vm.Script(cjsCode, { filename: filePath });
    script.runInNewContext(sandbox);
    return mod.exports;
  } catch (err) {
    throw new Error("Failed to execute compiled page " + filePath + ": " + err.message);
  }
}
function esmToCjs(code) {
  let result = code;
  result = result.replace(/import\s+(\w+)\s+from\s+["']([^"']+)["'];?/g, "const $1 = (function() \\{ const _m = require(\"$2\"); return _m && _m.default || _m; \\})();");
  result = result.replace(/import\s+\{([^}]+)\}\s+from\s+["']([^"']+)["'];?/g, "const \\{$1\\} = require(\"$2\");");
  result = result.replace(/export\s+default\s+(class|function)\s+(\w+)/g, "$1 $2");
  const defaultMatch = code.match(/export\s+default\s+(?:class|function)\s+(\w+)/);
  result = result.replace(/export\s+(class|function|const|let|var)\s+/g, "$1 ");
  const namedExports = [];
  const exportMatches = code.matchAll(/export\s+(?:class|function)\s+(\w+)/g);
  for (const m of exportMatches) {
    if (!code.includes("export default " + m[0].replace("export ", ""))) {
      namedExports.push(m[1]);
    }
  }
  const constExports = code.matchAll(/export\s+(?:const|let|var)\s+(\w+)/g);
  for (const m of constExports) {
    namedExports.push(m[1]);
  }
  if (namedExports.length > 0) {
    result += "\n" + namedExports.map(n => {
      return "module.exports." + n + " = typeof " + n + " !== 'undefined' ? " + n + " : undefined;";
    }).join("\n");
  }
  if (defaultMatch) {
    result += "\nmodule.exports.default = " + defaultMatch[1] + ";";
    result += `
module.exports = Object.assign(module.exports, { default: ` + defaultMatch[1] + " \\});";
  }
  return result;
}
export { compileNoFile, esmToCjs };