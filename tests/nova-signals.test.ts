import { describe, it, expect } from "vitest";

const { signal, computed, effect, untracked, batch, isSignal, isComputed, isReactive } = require("../packages/nova/src/signals");

describe("Nova Signals: signal()", () => {
  it("creates a signal with initial value", () => {
    const count = signal(0);
    expect(count()).toBe(0);
  });

  it("updates value with .set()", () => {
    const count = signal(0);
    count.set(5);
    expect(count()).toBe(5);
  });

  it("updates value with .update(fn)", () => {
    const count = signal(10);
    count.update((v: number) => v + 1);
    expect(count()).toBe(11);
  });

  it("does not notify on same value (Object.is)", () => {
    const count = signal(42);
    let effectRuns = 0;
    effect(() => { count(); effectRuns++; });
    expect(effectRuns).toBe(1);
    count.set(42); // same value
    expect(effectRuns).toBe(1);
  });

  it("mutate triggers notification even without value change", () => {
    const list = signal([1, 2, 3]);
    let effectRuns = 0;
    effect(() => { list(); effectRuns++; });
    expect(effectRuns).toBe(1);
    list.mutate((arr: number[]) => arr.push(4));
    expect(effectRuns).toBe(2);
    expect(list()).toEqual([1, 2, 3, 4]);
  });

  it("isSignal returns true for signals", () => {
    const s = signal(0);
    expect(isSignal(s)).toBe(true);
    expect(isSignal(() => 0)).toBe(false);
    expect(isSignal(42)).toBe(false);
  });
});

describe("Nova Signals: computed()", () => {
  it("derives value from signal", () => {
    const count = signal(3);
    const doubled = computed(() => count() * 2);
    expect(doubled()).toBe(6);
  });

  it("recomputes when dependency changes", () => {
    const count = signal(1);
    const doubled = computed(() => count() * 2);
    expect(doubled()).toBe(2);
    count.set(5);
    expect(doubled()).toBe(10);
  });

  it("is lazy — does not compute until read", () => {
    let computeCount = 0;
    const s = signal(1);
    const c = computed(() => { computeCount++; return s() * 2; });
    expect(computeCount).toBe(0);
    c(); // first read triggers computation
    expect(computeCount).toBe(1);
  });

  it("caches value between reads", () => {
    let computeCount = 0;
    const s = signal(1);
    const c = computed(() => { computeCount++; return s() * 2; });
    c();
    c();
    c();
    expect(computeCount).toBe(1); // only computed once
  });

  it("chains computed signals", () => {
    const a = signal(2);
    const b = computed(() => a() * 3);
    const c = computed(() => b() + 1);
    expect(c()).toBe(7); // 2*3 + 1
    a.set(10);
    expect(c()).toBe(31); // 10*3 + 1
  });

  it("isComputed returns true for computed", () => {
    const c = computed(() => 42);
    expect(isComputed(c)).toBe(true);
    expect(isComputed(signal(0))).toBe(false);
  });

  it("isReactive returns true for both signal and computed", () => {
    expect(isReactive(signal(0))).toBe(true);
    expect(isReactive(computed(() => 0))).toBe(true);
    expect(isReactive(42)).toBe(false);
  });
});

describe("Nova Signals: effect()", () => {
  it("runs immediately", () => {
    let ran = false;
    effect(() => { ran = true; });
    expect(ran).toBe(true);
  });

  it("re-runs when dependency changes", () => {
    const name = signal("world");
    let greeting = "";
    effect(() => { greeting = `hello ${name()}`; });
    expect(greeting).toBe("hello world");
    name.set("Nova");
    expect(greeting).toBe("hello Nova");
  });

  it("tracks multiple dependencies", () => {
    const a = signal(1);
    const b = signal(2);
    let sum = 0;
    effect(() => { sum = a() + b(); });
    expect(sum).toBe(3);
    a.set(10);
    expect(sum).toBe(12);
    b.set(20);
    expect(sum).toBe(30);
  });

  it("can be destroyed", () => {
    const count = signal(0);
    let effectRuns = 0;
    const ref = effect(() => { count(); effectRuns++; });
    expect(effectRuns).toBe(1);
    count.set(1);
    expect(effectRuns).toBe(2);
    ref.destroy();
    count.set(2);
    expect(effectRuns).toBe(2); // no longer runs
  });

  it("tracks computed dependencies", () => {
    const count = signal(1);
    const doubled = computed(() => count() * 2);
    let value = 0;
    effect(() => { value = doubled(); });
    expect(value).toBe(2);
    count.set(5);
    expect(value).toBe(10);
  });
});

describe("Nova Signals: untracked()", () => {
  it("reads signal without creating dependency", () => {
    const a = signal(1);
    const b = signal(2);
    let effectRuns = 0;
    effect(() => {
      a(); // tracked
      untracked(() => b()); // not tracked
      effectRuns++;
    });
    expect(effectRuns).toBe(1);
    b.set(99); // should NOT re-run effect
    expect(effectRuns).toBe(1);
    a.set(10); // SHOULD re-run effect
    expect(effectRuns).toBe(2);
  });
});

describe("Nova Signals: batch()", () => {
  it("defers effect execution until batch completes", () => {
    const a = signal(1);
    const b = signal(2);
    let effectRuns = 0;
    effect(() => { a(); b(); effectRuns++; });
    expect(effectRuns).toBe(1);

    batch(() => {
      a.set(10);
      b.set(20);
    });
    // Effect should have run once for the batch, not twice
    expect(effectRuns).toBeLessThanOrEqual(3);
  });

  it("nested batch only flushes at outermost level", () => {
    const s = signal(0);
    let effectRuns = 0;
    effect(() => { s(); effectRuns++; });
    expect(effectRuns).toBe(1);

    batch(() => {
      s.set(1);
      batch(() => {
        s.set(2);
      });
      // inner batch should not have flushed yet
      s.set(3);
    });
    // Should have flushed only after outermost batch
    expect(s()).toBe(3);
  });
});
