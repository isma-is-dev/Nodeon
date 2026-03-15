/**
 * Nova Signals — Angular-style fine-grained reactivity.
 *
 * API:
 *   signal(initialValue)        → WritableSignal  (.set, .update, .mutate)
 *   computed(() => expr)        → ReadonlySignal   (auto-tracked, lazy, cached)
 *   effect(() => { ... })       → EffectRef        (auto-tracked, returns { destroy })
 *   untracked(() => expr)       → T                (read without tracking)
 *   batch(() => { ... })        → void             (defer notifications)
 */

"use strict";

// ── Dependency Tracking Context ─────────────────────────────────

let activeConsumer = null;
let batchDepth = 0;
let pendingEffects = new Set();

// ── Signal (writable) ───────────────────────────────────────────

let nextId = 0;

function signal(initialValue) {
  let value = initialValue;
  const id = nextId++;
  const subscribers = new Set();
  let version = 0;

  function read() {
    // Track dependency if there's an active consumer
    if (activeConsumer) {
      activeConsumer.deps.add(sig);
      subscribers.add(activeConsumer);
    }
    return value;
  }

  // Make the signal callable: sig() returns value
  const sig = read;
  sig._id = id;
  sig._type = "signal";

  sig.set = function (newValue) {
    if (Object.is(value, newValue)) return;
    value = newValue;
    version++;
    notify(subscribers);
  };

  sig.update = function (fn) {
    sig.set(fn(value));
  };

  sig.mutate = function (fn) {
    fn(value);
    version++;
    notify(subscribers);
  };

  sig.subscribe = function (consumer) {
    subscribers.add(consumer);
    return function unsubscribe() { subscribers.delete(consumer); };
  };

  sig._version = function () { return version; };
  sig._subscribers = subscribers;

  return sig;
}

// ── Computed (read-only, lazy, cached) ──────────────────────────

function computed(computeFn) {
  let cachedValue;
  let dirty = true;
  let version = 0;
  const subscribers = new Set();

  // Internal consumer to track which signals this computed reads
  const consumer = {
    deps: new Set(),
    notify: function () {
      if (!dirty) {
        dirty = true;
        version++;
        notify(subscribers);
      }
    },
  };

  function read() {
    // Track this computed as a dependency of the active consumer
    if (activeConsumer) {
      activeConsumer.deps.add(comp);
      subscribers.add(activeConsumer);
    }

    if (dirty) {
      // Clean up old deps
      for (const dep of consumer.deps) {
        if (dep._subscribers) dep._subscribers.delete(consumer);
      }
      consumer.deps.clear();

      // Run computation with tracking
      const prev = activeConsumer;
      activeConsumer = consumer;
      try {
        cachedValue = computeFn();
      } finally {
        activeConsumer = prev;
      }
      dirty = false;
    }
    return cachedValue;
  }

  const comp = read;
  comp._id = nextId++;
  comp._type = "computed";
  comp._version = function () { return version; };
  comp._subscribers = subscribers;

  return comp;
}

// ── Effect (auto-tracked side effect) ───────────────────────────

function effect(effectFn) {
  let destroyed = false;

  const consumer = {
    deps: new Set(),
    notify: function () {
      if (destroyed) return;
      if (batchDepth > 0) {
        pendingEffects.add(run);
      } else {
        run();
      }
    },
  };

  function run() {
    if (destroyed) return;

    // Clean up old deps
    for (const dep of consumer.deps) {
      if (dep._subscribers) dep._subscribers.delete(consumer);
    }
    consumer.deps.clear();

    // Run effect with tracking
    const prev = activeConsumer;
    activeConsumer = consumer;
    try {
      effectFn();
    } finally {
      activeConsumer = prev;
    }
  }

  // Run immediately
  run();

  return {
    destroy: function () {
      destroyed = true;
      for (const dep of consumer.deps) {
        if (dep._subscribers) dep._subscribers.delete(consumer);
      }
      consumer.deps.clear();
    },
  };
}

// ── Utilities ───────────────────────────────────────────────────

function untracked(fn) {
  const prev = activeConsumer;
  activeConsumer = null;
  try {
    return fn();
  } finally {
    activeConsumer = prev;
  }
}

function batch(fn) {
  batchDepth++;
  try {
    fn();
  } finally {
    batchDepth--;
    if (batchDepth === 0) {
      const effects = Array.from(pendingEffects);
      pendingEffects.clear();
      for (const run of effects) run();
    }
  }
}

// ── Internal Notification ───────────────────────────────────────

function notify(subscribers) {
  if (batchDepth > 0) {
    // In batch mode, just mark consumers for later
    for (const sub of subscribers) {
      if (sub.notify) pendingEffects.add(sub.notify.bind(sub));
    }
    return;
  }
  // Notify all subscribers
  const subs = Array.from(subscribers);
  for (const sub of subs) {
    if (sub.notify) sub.notify();
  }
}

// ── isSignal / isComputed helpers ───────────────────────────────

function isSignal(val) {
  return typeof val === "function" && val._type === "signal";
}

function isComputed(val) {
  return typeof val === "function" && val._type === "computed";
}

function isReactive(val) {
  return isSignal(val) || isComputed(val);
}

module.exports = { signal, computed, effect, untracked, batch, isSignal, isComputed, isReactive };
