import type { Program } from "@ast/nodes";
import type { CompileOptions, CompileResult } from "./compile";

/**
 * CompilerPlugin — hook interface for extending the Nodeon compilation pipeline.
 *
 * Plugins can transform source text, AST nodes, or generated JS at each phase.
 * Multiple plugins are executed in registration order.
 */
export interface CompilerPlugin {
  /** Unique name for diagnostics and debugging */
  name: string;

  /** Transform source text before lexing/parsing */
  beforeParse?(source: string, options: PluginContext): string;

  /** Transform AST after parsing (before type checking) */
  afterParse?(ast: Program, options: PluginContext): Program;

  /** Transform AST after type checking, before JS generation */
  beforeGenerate?(ast: Program, options: PluginContext): Program;

  /** Transform generated JS output */
  afterGenerate?(js: string, options: PluginContext): string;

  /** Custom import resolution — return resolved path or null to skip */
  resolveImport?(specifier: string, fromFile: string): string | null;
}

export interface PluginContext {
  /** Original source file path (if known) */
  filePath?: string;
  /** Compile options passed by the user */
  compileOptions: CompileOptions;
  /** Metadata bag — plugins can store/read arbitrary data */
  metadata: Record<string, any>;
}

/**
 * PluginRegistry — manages compiler plugins for a compilation session.
 */
export class PluginRegistry {
  private plugins: CompilerPlugin[] = [];

  register(plugin: CompilerPlugin): void {
    this.plugins.push(plugin);
  }

  unregister(name: string): void {
    this.plugins = this.plugins.filter(p => p.name !== name);
  }

  getPlugins(): readonly CompilerPlugin[] {
    return this.plugins;
  }

  clear(): void {
    this.plugins = [];
  }

  /** Run all beforeParse hooks in order */
  runBeforeParse(source: string, ctx: PluginContext): string {
    let result = source;
    for (const plugin of this.plugins) {
      if (plugin.beforeParse) {
        result = plugin.beforeParse(result, ctx);
      }
    }
    return result;
  }

  /** Run all afterParse hooks in order */
  runAfterParse(ast: Program, ctx: PluginContext): Program {
    let result = ast;
    for (const plugin of this.plugins) {
      if (plugin.afterParse) {
        result = plugin.afterParse(result, ctx);
      }
    }
    return result;
  }

  /** Run all beforeGenerate hooks in order */
  runBeforeGenerate(ast: Program, ctx: PluginContext): Program {
    let result = ast;
    for (const plugin of this.plugins) {
      if (plugin.beforeGenerate) {
        result = plugin.beforeGenerate(result, ctx);
      }
    }
    return result;
  }

  /** Run all afterGenerate hooks in order */
  runAfterGenerate(js: string, ctx: PluginContext): string {
    let result = js;
    for (const plugin of this.plugins) {
      if (plugin.afterGenerate) {
        result = plugin.afterGenerate(result, ctx);
      }
    }
    return result;
  }

  /** Try to resolve an import via plugins, return first non-null result */
  runResolveImport(specifier: string, fromFile: string): string | null {
    for (const plugin of this.plugins) {
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

/** Global default plugin registry */
export const defaultRegistry = new PluginRegistry();
