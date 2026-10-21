// Nova Jobs & Queues — Background job processing with cron scheduling
// @job decorator support, in-memory queue, cron parser, manual dispatch

/**
 * Create a job queue for background processing.
 */
function createJobQueue(options) {
  const opts = options || {};
  const concurrency = opts.concurrency || 1;
  const retryAttempts = opts.retryAttempts || 3;
  const retryDelay = opts.retryDelay || 1000;

  const jobs = new Map();
  const queue = [];
  let running = 0;
  let paused = false;
  const listeners = { completed: [], failed: [], progress: [] };

  function on(event, handler) {
    if (listeners[event]) listeners[event].push(handler);
  }

  function emit(event, data) {
    if (listeners[event]) {
      for (const handler of listeners[event]) {
        try { handler(data); } catch (e) { /* ignore */ }
      }
    }
  }

  function registerJob(name, handler, jobOpts) {
    jobs.set(name, { handler: handler, options: jobOpts || {} });
  }

  function dispatch(name, payload) {
    return new Promise(function(resolve, reject) {
      const job = jobs.get(name);
      if (!job) {
        reject(new Error("Job '" + name + "' is not registered"));
        return;
      }

      const entry = {
        id: generateId(),
        name: name,
        payload: payload || {},
        attempts: 0,
        maxAttempts: job.options.retryAttempts || retryAttempts,
        retryDelay: job.options.retryDelay || retryDelay,
        status: "pending",
        createdAt: Date.now(),
        resolve: resolve,
        reject: reject,
      };

      queue.push(entry);
      processQueue();
    });
  }

  function processQueue() {
    if (paused) return;

    while (running < concurrency && queue.length > 0) {
      const entry = queue.shift();
      if (!entry) break;
      running++;
      entry.status = "running";
      runJob(entry);
    }
  }

  function runJob(entry) {
    const job = jobs.get(entry.name);
    if (!job) {
      running--;
      entry.reject(new Error("Job handler not found"));
      processQueue();
      return;
    }

    entry.attempts++;

    const ctx = {
      id: entry.id,
      name: entry.name,
      attempt: entry.attempts,
      progress: function(pct) {
        emit("progress", { id: entry.id, name: entry.name, progress: pct });
      },
    };

    Promise.resolve()
      .then(function() { return job.handler(entry.payload, ctx); })
      .then(function(result) {
        running--;
        entry.status = "completed";
        emit("completed", { id: entry.id, name: entry.name, result: result });
        entry.resolve(result);
        processQueue();
      })
      .catch(function(err) {
        if (entry.attempts < entry.maxAttempts) {
          entry.status = "retrying";
          setTimeout(function() {
            queue.push(entry);
            running--;
            processQueue();
          }, entry.retryDelay * entry.attempts);
        } else {
          running--;
          entry.status = "failed";
          emit("failed", { id: entry.id, name: entry.name, error: err });
          entry.reject(err);
          processQueue();
        }
      });
  }

  function pause() { paused = true; }
  function resume() { paused = false; processQueue(); }

  return {
    register: registerJob,
    dispatch: dispatch,
    on: on,
    pause: pause,
    resume: resume,
    get pending() { return queue.length; },
    get active() { return running; },
  };
}

/**
 * Parse a cron expression into a schedule descriptor.
 * Supports: "* * * * *" (min hour dom month dow)
 * Also supports: @hourly, @daily, @weekly, @monthly
 */
function parseCron(expression) {
  const aliases = {
    "@hourly": "0 * * * *",
    "@daily": "0 0 * * *",
    "@weekly": "0 0 * * 0",
    "@monthly": "0 0 1 * *",
    "@yearly": "0 0 1 1 *",
  };

  const expr = aliases[expression] || expression;
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error("Invalid cron expression: " + expression);
  }

  return {
    minute: parseCronField(parts[0], 0, 59),
    hour: parseCronField(parts[1], 0, 23),
    dayOfMonth: parseCronField(parts[2], 1, 31),
    month: parseCronField(parts[3], 1, 12),
    dayOfWeek: parseCronField(parts[4], 0, 6),
    original: expression,
  };
}

function parseCronField(field, min, max) {
  if (field === "*") return null; // any
  if (field.includes("/")) {
    const parts = field.split("/");
    var step = parseInt(parts[1], 10);
    var values = [];
    for (var i = min; i <= max; i += step) values.push(i);
    return values;
  }
  if (field.includes(",")) {
    return field.split(",").map(function(v) { return parseInt(v, 10); });
  }
  if (field.includes("-")) {
    var rangeParts = field.split("-");
    var start = parseInt(rangeParts[0], 10);
    var end = parseInt(rangeParts[1], 10);
    var vals = [];
    for (var j = start; j <= end; j++) vals.push(j);
    return vals;
  }
  return [parseInt(field, 10)];
}

function matchesCron(schedule, date) {
  var d = date || new Date();
  if (schedule.minute && !schedule.minute.includes(d.getMinutes())) return false;
  if (schedule.hour && !schedule.hour.includes(d.getHours())) return false;
  if (schedule.dayOfMonth && !schedule.dayOfMonth.includes(d.getDate())) return false;
  if (schedule.month && !schedule.month.includes(d.getMonth() + 1)) return false;
  if (schedule.dayOfWeek && !schedule.dayOfWeek.includes(d.getDay())) return false;
  return true;
}

/**
 * Create a cron scheduler that triggers jobs on schedule.
 */
function createScheduler(jobQueue) {
  const schedules = [];
  let timer = null;

  function schedule(cronExpr, jobName, payload) {
    var parsed = parseCron(cronExpr);
    schedules.push({ cron: parsed, jobName: jobName, payload: payload || {} });
  }

  function start() {
    if (timer) return;
    timer = setInterval(function() {
      var now = new Date();
      for (var i = 0; i < schedules.length; i++) {
        var s = schedules[i];
        if (matchesCron(s.cron, now)) {
          jobQueue.dispatch(s.jobName, s.payload).catch(function() {});
        }
      }
    }, 60000); // Check every minute
  }

  function stop() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  return {
    schedule: schedule,
    start: start,
    stop: stop,
    get scheduleCount() { return schedules.length; },
  };
}

function generateId() {
  var chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  var id = "";
  for (var i = 0; i < 12; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}

module.exports = {
  createJobQueue,
  createScheduler,
  parseCron,
  matchesCron,
};
