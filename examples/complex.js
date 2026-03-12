function double(x) {
  return x * 2;
}
function clamp(value, min = 0, max = 100) {
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
}
class ApiClient {
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
    this.headers = { "Content-Type": "application/json" };
    this.cache = {};
  }

  buildUrl(path) {
    return this.baseUrl + path;
  }

  async get(path) {
    let url = this.buildUrl(path);
    if (this.cache[url] !== null) {
      console.log(`Cache hit: ${url}`);
      return this.cache[url];
    }
    try {
      let response = fetch(url, { method: "GET", headers: this.headers });
      let data = response.json();
      this.cache[url] = data;
      return data;
    } catch (err) {
      console.log(`Request failed: ${err}`);
      throw new Error(`GET ${path} failed`);
    }
  }

  async post(path, body) {
    let url = this.buildUrl(path);
    let options = { method: "POST", headers: this.headers, body: JSON.stringify(body) };
    try {
      let response = fetch(url, options);
      return response.json();
    } catch (err) {
      console.log(`POST failed: ${err}`);
      return null;
    }
  }
}
let client = new ApiClient("https://api.example.com");
let items = ["alpha", "beta", "gamma"];
for (const item of items) {
  console.log(`Item: ${item}`);
}
for (let i = 0; i <= 5; i++) {
  let result = double(i);
  console.log(`double(${i}) = ${result}`);
}
let score = 85;
let clamped = clamp(score, 0, 100);
if (clamped >= 90) {
  console.log("Grade: A");
} else if (clamped >= 80) {
  console.log("Grade: B");
} else if (clamped >= 70) {
  console.log("Grade: C");
} else {
  console.log("Grade: F");
}
let numbers = [1, 2, 3, 4, 5];
let doubled = numbers.map(n => n * 2);
let evens = numbers.filter(n => n % 2 === 0);
console.log(`Doubled: ${doubled}`);
console.log(`Evens: ${evens}`);
let counter = 10;
while (counter > 0) {
  counter = counter - 1;
}
console.log("Countdown done");
let config = { host: "localhost", port: 3000, debug: true };
console.log(`Server: ${config.host}:${config.port}`);