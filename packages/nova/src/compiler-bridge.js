// Bridge between Nova and the Nodeon compiler.
// Compiles .no page files to JS modules on-the-fly for the dev server.

const fs = require("fs");
const path = require("path");
const vm = require("vm");

// Try to load the Nodeon compiler
let compiler = null;
function getCompiler() {
  if (compiler) return compiler;

  // Try self-hosted bundle first
  const bundlePath = path.resolve(__dirname, "../../../dist-no/nodeon-compiler.cjs");
  if (fs.existsSync(bundlePath)) {
    compiler = require(bundlePath);
    return compiler;
  }

  // Fallback: try TS compiler
  try {
    require("ts-node").register({ transpileOnly: true });
    require("tsconfig-paths").register();
    compiler = require("../../../src/compiler/compile");
    return compiler;
  } catch (e) {
    throw new Error("Nodeon compiler not found. Run 'npm run build' first.");
  }
}

/**
 * Compile a .no file and return its exports as a module.
 * @param {string} filePath - Absolute path to the .no file
 * @returns {object} The module's exports
 */
function compileNoFile(filePath) {
  const source = fs.readFileSync(filePath, "utf8");
  const { js } = getCompiler().compile(source);

  // Execute the compiled JS in a sandbox and collect exports
  const mod = { exports: {} };
  const sandbox = {
    module: mod,
    exports: mod.exports,
    require: require,
    __filename: filePath,
    __dirname: path.dirname(filePath),
    console: console,
    process: process,
    Buffer: Buffer,
    setTimeout: setTimeout,
    setInterval: setInterval,
    clearTimeout: clearTimeout,
    clearInterval: clearInterval,
  };

  // Transform ESM imports/exports to CJS for vm execution
  let cjsCode = esmToCjs(js);

  try {
    const script = new vm.Script(cjsCode, { filename: filePath });
    script.runInNewContext(sandbox);
    return mod.exports;
  } catch (err) {
    throw new Error("Failed to execute compiled page " + filePath + ": " + err.message);
  }
}

/**
 * Quick ESM → CJS transform for page modules.
 * Handles: import X from 'y', import { a, b } from 'y', export class/fn/const, export default
 */
function esmToCjs(code) {
  let result = code;

  // import X from 'y' → const X = require('y').default || require('y')
  result = result.replace(
    /import\s+(\w+)\s+from\s+["']([^"']+)["'];?/g,
    'const $1 = (function() { const _m = require("$2"); return _m && _m.default || _m; })();'
  );

  // import { a, b } from 'y' → const { a, b } = require('y')
  result = result.replace(
    /import\s+\{([^}]+)\}\s+from\s+["']([^"']+)["'];?/g,
    'const {$1} = require("$2");'
  );

  // export default X → module.exports.default = X; module.exports = ...
  result = result.replace(
    /export\s+default\s+(class|function)\s+(\w+)/g,
    '$1 $2'
  );
  // Add module.exports at end for default exports
  const defaultMatch = code.match(/export\s+default\s+(?:class|function)\s+(\w+)/);

  // export class/function X → class/function X; module.exports.X = X
  result = result.replace(/export\s+(class|function|const|let|var)\s+/g, '$1 ');

  // Collect named exports
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

  // Append exports
  if (namedExports.length > 0) {
    result += "\n" + namedExports.map(function(n) {
      return "module.exports." + n + " = typeof " + n + " !== 'undefined' ? " + n + " : undefined;";
    }).join("\n");
  }
  if (defaultMatch) {
    result += "\nmodule.exports.default = " + defaultMatch[1] + ";";
    result += "\nmodule.exports = Object.assign(module.exports, { default: " + defaultMatch[1] + " });";
  }

  return result;
}

module.exports = { compileNoFile, esmToCjs };
