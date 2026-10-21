// Nova Decorators — @page, @api, @island, @service, @layout, @middleware
// These attach metadata to classes for the Nova framework runtime.

/**
 * @page(path) — marks a class as a page component with a route path.
 * Usage: @page("/about") class AboutPage { template() { ... } }
 */
export function page(pathOrClass) {
  if (typeof pathOrClass === "function") {
    // Used as @page without arguments — infer path from filename
    pathOrClass._page = { path: null };
    return pathOrClass;
  }
  // Used as @page("/about")
  return function(Class) {
    Class._page = { path: pathOrClass };
    return Class;
  };
}

/**
 * @api(path, options) — marks a class as an API route handler.
 * Usage: @api("/api/users") class UsersApi { get() {} post() {} }
 */
export function api(pathOrClass, opts) {
  if (typeof pathOrClass === "function") {
    pathOrClass._api = { path: null, methods: extractMethods(pathOrClass) };
    return pathOrClass;
  }
  const options = opts || {};
  return function(Class) {
    Class._api = {
      path: pathOrClass,
      methods: extractMethods(Class),
      middleware: options.middleware || [],
    };
    return Class;
  };
}

/**
 * @layout(name) — marks a class as a layout wrapper.
 * Usage: @layout("main") class MainLayout { template(content) { ... } }
 */
export function layout(nameOrClass) {
  if (typeof nameOrClass === "function") {
    nameOrClass._layout = { name: nameOrClass.name };
    return nameOrClass;
  }
  return function(Class) {
    Class._layout = { name: nameOrClass };
    return Class;
  };
}

/**
 * @middleware(path) — marks a class as middleware.
 * Usage: @middleware class AuthMiddleware { handle(req, res, next) { ... } }
 */
export function middleware(pathOrClass) {
  if (typeof pathOrClass === "function") {
    pathOrClass._middleware = { path: "/*" };
    return pathOrClass;
  }
  return function(Class) {
    Class._middleware = { path: pathOrClass };
    return Class;
  };
}

/**
 * @service(options) — marks a class as an injectable service.
 * Usage: @service class UserService { ... }
 *        @service({ scope: "request" }) class SessionService { ... }
 */
export function service(optsOrClass) {
  if (typeof optsOrClass === "function") {
    optsOrClass._service = { scope: "singleton", deps: optsOrClass._deps || [] };
    return optsOrClass;
  }
  const opts = optsOrClass || {};
  return function(Class) {
    Class._service = {
      scope: opts.scope || "singleton",
      deps: opts.deps || Class._deps || [],
    };
    return Class;
  };
}

/**
 * @inject(token) — parameter decorator for dependency injection.
 * Usage: constructor(@inject(DbService) db) { ... }
 */
export function inject(token) {
  return { __inject: true, token: token };
}

// --- Route metadata collection ---

/**
 * Collect all route metadata from a set of modules.
 * Returns { pages: [...], apis: [...], layouts: [...], middleware: [...] }
 */
export function collectRouteMetadata(modules) {
  const pages = [];
  const apis = [];
  const layouts = [];
  const mws = [];

  for (const mod of modules) {
    const exports = mod.exports || mod;
    const keys = Object.keys(exports);
    for (const key of keys) {
      const cls = exports[key];
      if (typeof cls !== "function") { continue; }
      if (cls._page) {
        pages.push({
          Class: cls,
          path: cls._page.path,
          name: cls.name || key,
        });
      }
      if (cls._api) {
        apis.push({
          Class: cls,
          path: cls._api.path,
          methods: cls._api.methods,
          middleware: cls._api.middleware || [],
          name: cls.name || key,
        });
      }
      if (cls._layout) {
        layouts.push({
          Class: cls,
          name: cls._layout.name,
        });
      }
      if (cls._middleware) {
        mws.push({
          Class: cls,
          path: cls._middleware.path,
          name: cls.name || key,
        });
      }
    }
  }

  return { pages: pages, apis: apis, layouts: layouts, middleware: mws };
}

// --- Helpers ---

function extractMethods(Class) {
  const methods = [];
  const proto = Class.prototype;
  if (!proto) { return methods; }
  const names = Object.getOwnPropertyNames(proto);
  const httpMethods = ["get", "post", "put", "patch", "head", "options"];
  for (const name of names) {
    if (name === "constructor") { continue; }
    // "delete" → "del" to avoid reserved keyword issues
    if (httpMethods.indexOf(name) !== -1 || name === "del") {
      methods.push(name === "del" ? "delete" : name);
    }
  }
  return methods;
}
