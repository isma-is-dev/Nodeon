import { describe, it, expect } from "vitest";

import { Injectable, Inject, InjectionToken, Container, rootContainer } from "../packages/nova/src/di.js";

describe("Nova DI: Container basics", () => {
  it("registers and resolves a class", () => {
    const c = new Container();
    class Logger { log(msg: string) { return msg; } }
    c.registerClass(Logger);
    const logger = c.resolve(Logger);
    expect(logger).toBeInstanceOf(Logger);
    expect(logger.log("hi")).toBe("hi");
  });

  it("resolves singleton by default (same instance)", () => {
    const c = new Container();
    class Svc {}
    c.registerClass(Svc);
    expect(c.resolve(Svc)).toBe(c.resolve(Svc));
  });

  it("resolves transient scope (new instance each time)", () => {
    const c = new Container();
    class Svc {}
    c.registerClass(Svc, { scope: "transient" });
    expect(c.resolve(Svc)).not.toBe(c.resolve(Svc));
  });

  it("resolves by string token", () => {
    const c = new Container();
    class MyService {}
    c.registerClass(MyService);
    const svc = c.resolve("MyService");
    expect(svc).toBeInstanceOf(MyService);
  });

  it("registers and resolves a constant value", () => {
    const c = new Container();
    c.registerValue("API_URL", "https://api.example.com");
    expect(c.resolve("API_URL")).toBe("https://api.example.com");
  });

  it("registers and resolves a factory", () => {
    const c = new Container();
    c.registerFactory("config", () => ({ debug: true }));
    expect(c.resolve("config")).toEqual({ debug: true });
  });

  it("throws for unregistered token", () => {
    const c = new Container();
    expect(() => c.resolve("Unknown")).toThrow("No provider for");
  });

  it("has() checks registration", () => {
    const c = new Container();
    c.registerValue("x", 1);
    expect(c.has("x")).toBe(true);
    expect(c.has("y")).toBe(false);
  });

  it("reset() clears singleton cache", () => {
    const c = new Container();
    class Svc {}
    c.registerClass(Svc);
    const first = c.resolve(Svc);
    c.reset();
    const second = c.resolve(Svc);
    expect(first).not.toBe(second);
  });
});

describe("Nova DI: Constructor injection", () => {
  it("injects dependencies into constructor", () => {
    const c = new Container();
    class Logger { log(msg: string) { return msg; } }
    class App {
      logger: any;
      static _deps = ["Logger"];
      constructor(logger: any) { this.logger = logger; }
    }
    c.registerClass(Logger);
    c.registerClass(App);
    const app = c.resolve(App);
    expect(app.logger).toBeInstanceOf(Logger);
    expect(app.logger.log("test")).toBe("test");
  });

  it("injects using Inject() markers", () => {
    const c = new Container();
    c.registerValue("DB_HOST", "localhost");
    class Repo {
      host: string;
      static _deps = [Inject("DB_HOST")];
      constructor(host: string) { this.host = host; }
    }
    c.registerClass(Repo);
    const repo = c.resolve(Repo);
    expect(repo.host).toBe("localhost");
  });

  it("injects factory dependencies", () => {
    const c = new Container();
    c.registerValue("PORT", 3000);
    c.registerFactory("serverUrl", (port: number) => `http://localhost:${port}`, [Inject("PORT")]);
    expect(c.resolve("serverUrl")).toBe("http://localhost:3000");
  });
});

describe("Nova DI: Injectable decorator", () => {
  it("marks class as injectable (direct)", () => {
    class Svc {}
    Injectable(Svc);
    expect(Svc._injectable).toBeDefined();
    expect(Svc._injectable.scope).toBe("singleton");
  });

  it("marks class with options", () => {
    class Svc {}
    Injectable({ scope: "transient", deps: ["A"] })(Svc);
    expect(Svc._injectable.scope).toBe("transient");
    expect(Svc._injectable.deps).toEqual(["A"]);
  });

  it("Injectable class uses _injectable metadata in container", () => {
    const c = new Container();
    class Logger {}
    Injectable(Logger);

    class App {
      static _deps = ["Logger"];
      constructor(public logger: any) { this.logger = logger; }
    }
    Injectable({ deps: ["Logger"] })(App);

    c.registerClass(Logger);
    c.registerClass(App);
    const app = c.resolve(App);
    expect(app.logger).toBeInstanceOf(Logger);
  });
});

describe("Nova DI: Hierarchical containers", () => {
  it("child resolves from parent", () => {
    const parent = new Container();
    parent.registerValue("env", "production");
    const child = parent.createChild();
    expect(child.resolve("env")).toBe("production");
  });

  it("child overrides parent", () => {
    const parent = new Container();
    parent.registerValue("env", "production");
    const child = parent.createChild();
    child.registerValue("env", "test");
    expect(child.resolve("env")).toBe("test");
    expect(parent.resolve("env")).toBe("production");
  });

  it("child has() checks parent", () => {
    const parent = new Container();
    parent.registerValue("x", 1);
    const child = parent.createChild();
    expect(child.has("x")).toBe(true);
    expect(child.has("y")).toBe(false);
  });
});

describe("Nova DI: Circular dependency detection", () => {
  it("throws on circular dependency", () => {
    const c = new Container();
    class A { static _deps = ["B"]; constructor(public b: any) {} }
    class B { static _deps = ["A"]; constructor(public a: any) {} }
    c.registerClass(A);
    c.registerClass(B);
    expect(() => c.resolve(A)).toThrow("Circular dependency");
  });
});

describe("Nova DI: InjectionToken", () => {
  it("creates a unique string token", () => {
    const token = InjectionToken("MyConfig");
    expect(token).toBe("InjectionToken:MyConfig");
  });

  it("can be used as container token", () => {
    const c = new Container();
    const CONFIG = InjectionToken("Config");
    c.registerValue(CONFIG, { debug: true });
    expect(c.resolve(CONFIG)).toEqual({ debug: true });
  });
});
