function Injectable(optsOrClass) {
  if (typeof optsOrClass === "function") {
    optsOrClass._injectable = { deps: optsOrClass._deps || [], scope: "singleton" };
    return optsOrClass;
  }
  const opts = optsOrClass || {};
  return Class => {
    Class._injectable = { deps: opts.deps || Class._deps || [], scope: opts.scope || "singleton" };
    return Class;
  };
}
function Inject(token) {
  return { __inject: true, token: token };
}
function InjectionToken(name) {
  return "InjectionToken:" + name;
}
class Container {
  constructor(parent) {
    this._providers = new Map();
    this._singletons = new Map();
    this._parent = parent || null;
    this._resolving = new Set();
  }

  register(token, provider) {
    const key = this._tokenKey(token);
    this._providers.set(key, provider);
    return this;
  }

  registerClass(Class, opts) {
    const scope = opts && opts.scope || Class._injectable && Class._injectable.scope || "singleton";
    const deps = Class._injectable && Class._injectable.deps || Class._deps || [];
    const key = this._tokenKey(Class);
    this._providers.set(key, { useClass: Class, deps: deps, scope: scope });
    if (Class.name) {
      this._providers.set(Class.name, { useClass: Class, deps: deps, scope: scope });
    }
    return this;
  }

  registerValue(token, value) {
    const key = this._tokenKey(token);
    this._providers.set(key, { useValue: value });
    return this;
  }

  registerFactory(token, factory, deps) {
    const key = this._tokenKey(token);
    this._providers.set(key, { useFactory: factory, deps: deps || [] });
    return this;
  }

  resolve(token) {
    const key = this._tokenKey(token);
    if (this._singletons.has(key)) {
      return this._singletons.get(key);
    }
    const provider = this._providers.get(key);
    if (!provider) {
      if (this._parent) {
        return this._parent.resolve(token);
      }
      throw new Error("[Nova DI] No provider for: " + key);
    }
    if ("useValue" in provider) {
      return provider.useValue;
    }
    if (this._resolving.has(key)) {
      throw new Error("[Nova DI] Circular dependency detected for: " + key);
    }
    this._resolving.add(key);
    let instance = undefined;
    try {
      if (provider.useFactory) {
        const resolvedDeps = this._resolveDeps(provider.deps || []);
        instance = provider.useFactory.apply(null, resolvedDeps);
      } else if (provider.useClass) {
        const resolvedDeps = this._resolveDeps(provider.deps || []);
        const Cls = provider.useClass;
        instance = new Cls(...resolvedDeps);
      } else {
        throw new Error("[Nova DI] Invalid provider for: " + key);
      }
    } finally {
      this._resolving.delete(key);
    }
    const scope = provider.scope || "singleton";
    if (scope === "singleton") {
      this._singletons.set(key, instance);
    }
    return instance;
  }

  has(token) {
    const key = this._tokenKey(token);
    if (this._providers.has(key)) {
      return true;
    }
    if (this._parent) {
      return this._parent.has(token);
    }
    return false;
  }

  createChild() {
    return new Container(this);
  }

  reset() {
    return this._singletons.clear();
  }

  _tokenKey(token) {
    if (typeof token === "string") {
      return token;
    }
    if (typeof token === "function") {
      return token.name || token.toString();
    }
    if (token && token.__inject) {
      return this._tokenKey(token.token);
    }
    return String(token);
  }

  _resolveDeps(deps) {
    return deps.map(dep => {
      if (dep && dep.__inject) {
        return this.resolve(dep.token);
      }
      return this.resolve(dep);
    });
  }
}
const rootContainer = new Container();
export { Injectable, Inject, InjectionToken, Container, rootContainer };