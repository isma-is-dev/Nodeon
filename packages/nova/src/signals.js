let activeConsumer = null;
let batchDepth = 0;
let pendingEffects = new Set();
let nextId = 0;
function signal(initialValue) {
  let value = initialValue;
  const id = nextId++;
  const subscribers = new Set();
  let version = 0;
  function read() {
    if (activeConsumer) {
      activeConsumer.deps.add(sig);
      subscribers.add(activeConsumer);
    }
    return value;
  }
  const sig = read;
  sig._id = id;
  sig._type = "signal";
  sig.set = newValue => {
    if (Object.is(value, newValue)) {
      return;
    }
    value = newValue;
    version++;
    notify(subscribers);
  };
  sig.update = updater => {
    sig.set(updater(value));
  };
  sig.mutate = mutator => {
    mutator(value);
    version++;
    notify(subscribers);
  };
  sig.subscribe = consumer => {
    subscribers.add(consumer);
    return () => {
      subscribers.delete(consumer);
    };
  };
  sig._version = () => {
    return version;
  };
  sig._subscribers = subscribers;
  return sig;
}
function computed(computeFn) {
  let cachedValue = undefined;
  let dirty = true;
  let version = 0;
  const subscribers = new Set();
  const consumer = { deps: new Set(), notify: () => {
    if (!dirty) {
      dirty = true;
      version++;
      notify(subscribers);
    }
  } };
  function read() {
    if (activeConsumer) {
      activeConsumer.deps.add(comp);
      subscribers.add(activeConsumer);
    }
    if (dirty) {
      for (const dep of consumer.deps) {
        if (dep._subscribers) {
          dep._subscribers.delete(consumer);
        }
      }
      consumer.deps.clear();
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
  comp._version = () => {
    return version;
  };
  comp._subscribers = subscribers;
  return comp;
}
function effect(effectFn) {
  let destroyed = false;
  const consumer = { deps: new Set(), notify: () => {
    if (destroyed) {
      return;
    }
    if (batchDepth > 0) {
      pendingEffects.add(run);
    } else {
      run();
    }
  } };
  function run() {
    if (destroyed) {
      return;
    }
    for (const dep of consumer.deps) {
      if (dep._subscribers) {
        dep._subscribers.delete(consumer);
      }
    }
    consumer.deps.clear();
    const prev = activeConsumer;
    activeConsumer = consumer;
    try {
      effectFn();
    } finally {
      activeConsumer = prev;
    }
  }
  run();
  return { destroy: () => {
    destroyed = true;
    for (const dep of consumer.deps) {
      if (dep._subscribers) {
        dep._subscribers.delete(consumer);
      }
    }
    consumer.deps.clear();
  } };
}
function untracked(callback) {
  const prev = activeConsumer;
  activeConsumer = null;
  try {
    return callback();
  } finally {
    activeConsumer = prev;
  }
}
function batch(callback) {
  batchDepth++;
  try {
    callback();
  } finally {
    batchDepth--;
    if (batchDepth === 0) {
      const effects = Array.from(pendingEffects);
      pendingEffects.clear();
      for (const run of effects) {
        run();
      }
    }
  }
}
function notify(subscribers) {
  if (batchDepth > 0) {
    for (const sub of subscribers) {
      if (sub.notify) {
        pendingEffects.add(sub.notify.bind(sub));
      }
    }
    return;
  }
  const subs = Array.from(subscribers);
  for (const sub of subs) {
    if (sub.notify) {
      sub.notify();
    }
  }
}
function isSignal(val) {
  return typeof val === "function" && val._type === "signal";
}
function isComputed(val) {
  return typeof val === "function" && val._type === "computed";
}
function isReactive(val) {
  return isSignal(val) || isComputed(val);
}
export { signal, computed, effect, untracked, batch, isSignal, isComputed, isReactive };