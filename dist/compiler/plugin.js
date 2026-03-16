export class PluginRegistry {
  #plugins = [];

  register(plugin) {
    return this.#plugins.push(plugin);
  }

  unregister(name) {
    return this.#plugins = this.#plugins.filter(p => p.name !== name);
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
}
export const defaultRegistry = new PluginRegistry();