class ValidationError {
  constructor(message, field) {
    this.name = "ValidationError";
    this.message = message;
    this.field = field;
  }
}
class Logger {
  constructor(prefix = "APP") {
    this.prefix = prefix;
    this.logs = [];
  }

  log(message) {
    let entry = `[${this.prefix}] ${message}`;
    this.logs.push(entry);
    console.log(entry);
  }

  dump() {
    for (const line of this.logs) {
      console.log(`LOG: ${line}`);
    }
  }
}
function fibonacci(n) {
  if (n < 0) {
    throw new Error(`Negative fibonacci not allowed: ${n}`);
  }
  if (n <= 1) {
    return n;
  }
  return fibonacci(n - 1) + fibonacci(n - 2);
}
function makeMultiplier(x) {
  function multiply(n) {
    return n * x;
  }
  return multiply;
}
let double = makeMultiplier(2);
let triple = makeMultiplier(3);
class FakeDatabase {
  constructor() {
    this.records = {};
  }

  save(id, data) {
    return this.records[id] = data;
  }

  get(id) {
    if (this.records[id] === null) {
      throw new Error(`Record ${id} not found`);
    }
    return this.records[id];
  }
}
let db = new FakeDatabase();
class UserService {
  constructor(logger) {
    this.logger = logger;
  }

  validate(user) {
    if (user.name === null) {
      throw new ValidationError("Name required", "name");
    }
    if (user.age < 0) {
      throw new ValidationError(`Age invalid: ${user.age}`, "age");
    }
  }

  register(user) {
    try {
      this.validate(user);
      let id = user.name + "-" + Date.now();
      db.save(id, user);
      this.logger.log(`User created: ${id}`);
      return id;
    } catch (err) {
      if (err.name === "ValidationError") {
        this.logger.log(`Validation failed on ${err.field}`);
        return null;
      }
      throw err;
    }
  }
}
let logger = new Logger("NODEON");
let service = new UserService(logger);
let users = [{ name: "Alice", age: 30 }, { name: "Bob", age: -5 }, { age: 20 }, { name: "Charlie", age: 25 }];
let ids = [];
for (const user of users) {
  let id = service.register(user);
  if (id !== null) {
    ids.push(id);
  }
}
async function fakeFetchUser(id) {
  try {
    let data = db.get(id);
    return { id: id, profile: data };
  } catch (err) {
    console.log(`Fetch error: ${err}`);
    return null;
  }
}
let results = [];
for (const id of ids) {
  let profile = fakeFetchUser(id);
  if (profile !== null) {
    results.push(profile);
  }
}
for (const user of results) {
  let name = user.profile.name;
  console.log(`Processing ${name}`);
  for (let i = 0; i <= 3; i++) {
    let fib = fibonacci(i);
    let value = double(fib);
    console.log(`loop ${i} fib=${fib} doubled=${value}`);
  }
}
let total = 0;
let numbers = [1, 2, 3, 4, 5];
for (const n of numbers) {
  total = total + n;
}
console.log(`Average: ${sum / numbers.length}`);
let i = 0;
while (i < 5) {
  console.log(`while iteration ${i}`);
  if (i === 3) {
    break;
  }
  i = i + 1;
}
let settings = { retries: 3, timeout: 1000, debug: true };
settings.timeout = settings.timeout * 2;
console.log(`Timeout now ${settings.timeout}`);
function divide(a, b) {
  if (b === 0) {
    throw new Error("Division by zero");
  }
  return a / b;
}
try {
  let result = divide(10, 0);
  console.log(`Result ${result}`);
} catch (err) {
  console.log(`Caught error: ${err}`);
}
logger.dump();
console.log("Execution finished");