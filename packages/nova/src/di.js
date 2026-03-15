/**
 * Nova Dependency Injection — Angular/NestJS-style DI container.
 *
 * API:
 *   Injectable(opts?)          — mark a class as injectable (decorator-like)
 *   Inject(token)              — parameter injection marker
 *   Container                  — DI container class
 *     .register(token, provider) — register a service
 *     .registerClass(Class)      — register a class by name
 *     .registerValue(token, val) — register a constant value
 *     .registerFactory(token, fn, deps) — register a factory function
 *     .resolve(token)            — resolve a dependency
 *     .createChild()             — create a child scope (hierarchical DI)
 *     .has(token)                — check if token is registered
 *
 * Supports:
 *   - Constructor injection via _deps metadata
 *   - Singleton scope (default) and transient scope
 *   - Hierarchical containers (parent-child)
 *   - Circular dependency detection
 */

"use strict";

// ── Injectable Decorator ────────────────────────────────────────

/**
 * Mark a class as injectable. Stores dependency metadata.
 * @param {object} [opts] - Options: { deps: [...tokens], scope: "singleton"|"transient" }
 * @returns {Function} Decorator function or decorated class
 */
function Injectable(optsOrClass) {
  // Used as Injectable(class) or Injectable({ deps })(class)
  if (typeof optsOrClass === "function") {
    // Direct: Injectable(MyClass)
    optsOrClass._injectable = { deps: optsOrClass._deps || [], scope: "singleton" };
    return optsOrClass;
  }

  // With options: Injectable({ deps: [...], scope: "transient" })
  const opts = optsOrClass || {};
  return function decorator(Class) {
    Class._injectable = {
      deps: opts.deps || Class._deps || [],
      scope: opts.scope || "singleton",
    };
    return Class;
  };
}

// ── Inject Marker ───────────────────────────────────────────────

/**
 * Create an injection token marker.
 * Usage: class MyService { static _deps = [Inject("Logger"), Inject("Config")] }
 * @param {string|Function} token - The token to inject
 * @returns {object} Injection marker
 */
function Inject(token) {
  return { __inject: true, token: token };
}

/**
 * Create a named injection token (for interfaces/abstractions).
 * @param {string} name - Token name
 * @returns {symbol|string} Unique token
 */
function InjectionToken(name) {
  return "InjectionToken:" + name;
}

// ── DI Container ────────────────────────────────────────────────

class Container {
  constructor(parent) {
    this._providers = new Map();
    this._singletons = new Map();
    this._parent = parent || null;
    this._resolving = new Set(); // circular dependency guard
  }

  /**
   * Register a provider for a token.
   * @param {string|Function} token - What to register as
   * @param {object} provider - { useClass, useValue, useFactory, deps, scope }
   */
  register(token, provider) {
    const key = this._tokenKey(token);
    this._providers.set(key, provider);
    return this;
  }

  /**
   * Register a class as a singleton (token = class name or class itself).
   * @param {Function} Class - The class to register
   * @param {object} [opts] - { scope: "singleton"|"transient" }
   */
  registerClass(Class, opts) {
    const scope = (opts && opts.scope) || (Class._injectable && Class._injectable.scope) || "singleton";
    const deps = (Class._injectable && Class._injectable.deps) || Class._deps || [];
    const key = this._tokenKey(Class);
    this._providers.set(key, { useClass: Class, deps: deps, scope: scope });
    // Also register by name for string-based resolution
    if (Class.name) {
      this._providers.set(Class.name, { useClass: Class, deps: deps, scope: scope });
    }
    return this;
  }

  /**
   * Register a constant value.
   * @param {string|Function} token
   * @param {*} value
   */
  registerValue(token, value) {
    const key = this._tokenKey(token);
    this._providers.set(key, { useValue: value });
    return this;
  }

  /**
   * Register a factory function.
   * @param {string|Function} token
   * @param {Function} factory - Factory function
   * @param {Array} [deps] - Dependencies to inject into factory
   */
  registerFactory(token, factory, deps) {
    const key = this._tokenKey(token);
    this._providers.set(key, { useFactory: factory, deps: deps || [] });
    return this;
  }

  /**
   * Resolve a dependency by token.
   * @param {string|Function} token
   * @returns {*} The resolved instance
   */
  resolve(token) {
    const key = this._tokenKey(token);

    // Check singleton cache first
    if (this._singletons.has(key)) {
      return this._singletons.get(key);
    }

    // Find provider
    const provider = this._providers.get(key);
    if (!provider) {
      // Try parent container
      if (this._parent) {
        return this._parent.resolve(token);
      }
      throw new Error("[Nova DI] No provider for: " + key);
    }

    // Constant value
    if ("useValue" in provider) {
      return provider.useValue;
    }

    // Circular dependency check
    if (this._resolving.has(key)) {
      throw new Error("[Nova DI] Circular dependency detected for: " + key);
    }
    this._resolving.add(key);

    let instance;
    try {
      if (provider.useFactory) {
        // Factory
        const resolvedDeps = this._resolveDeps(provider.deps || []);
        instance = provider.useFactory.apply(null, resolvedDeps);
      } else if (provider.useClass) {
        // Class instantiation
        const resolvedDeps = this._resolveDeps(provider.deps || []);
        instance = new provider.useClass(...resolvedDeps);
      } else {
        throw new Error("[Nova DI] Invalid provider for: " + key);
      }
    } finally {
      this._resolving.delete(key);
    }

    // Cache singleton
    const scope = provider.scope || "singleton";
    if (scope === "singleton") {
      this._singletons.set(key, instance);
    }

    return instance;
  }

  /**
   * Check if a token has a provider (including parent).
   * @param {string|Function} token
   * @returns {boolean}
   */
  has(token) {
    const key = this._tokenKey(token);
    if (this._providers.has(key)) return true;
    if (this._parent) return this._parent.has(token);
    return false;
  }

  /**
   * Create a child container that inherits from this one.
   * @returns {Container}
   */
  createChild() {
    return new Container(this);
  }

  /**
   * Reset all singletons (useful for testing).
   */
  reset() {
    this._singletons.clear();
  }

  // ── Internal ────────────────────────────────────────────────

  _tokenKey(token) {
    if (typeof token === "string") return token;
    if (typeof token === "function") return token.name || token.toString();
    if (token && token.__inject) return this._tokenKey(token.token);
    return String(token);
  }

  _resolveDeps(deps) {
    return deps.map(function(dep) {
      if (dep && dep.__inject) {
        return this.resolve(dep.token);
      }
      return this.resolve(dep);
    }.bind(this));
  }
}

// ── Global Container ────────────────────────────────────────────

const rootContainer = new Container();

module.exports = {
  Injectable,
  Inject,
  InjectionToken,
  Container,
  rootContainer,
};
