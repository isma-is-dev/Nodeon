let x = 42;
const PI = 3.14159;
let name = "Nodeon";
let hex = 255;
let bin = 10;
let oct = 63;
let color = "red";
switch (color) {
  case "red":
    console.log("Stop!");
  case "green":
    console.log("Go!");
  default:
    console.log("Unknown color");
}
let n = 5;
do {
  n = n - 1;
} while (n > 0);
let counter = 0;
counter += 10;
counter -= 3;
counter *= 2;
let status = counter > 10 ? "high" : "low";
console.log(`Counter status: ${status}`);
console.log(typeof x);
let config = { db: { host: "localhost" } };
let port = config.db?.port;
console.log(`Port: ${port}`);
let fallback = port ?? 3000;
console.log(`Using port: ${fallback}`);
try {
  let result = JSON.parse("{\"ok\": true}");
  console.log(`Parsed: ${result.ok}`);
} catch (err) {
  console.log(`Error: ${err}`);
} finally {
  console.log("Cleanup done");
}
for (let i = 0; i <= 10; i++) {
  if (i === 3) {
    continue;
  }
  if (i === 7) {
    break;
  }
  console.log(i);
}
let a = "5";
let b = 5;
if (a === b) {
  console.log("equal");
} else {
  console.log("not equal (=== comparison)");
}
let greeting = `Hello ${name}, you have ${counter} items`;
console.log(greeting);