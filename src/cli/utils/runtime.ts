import vm from "vm";

const sandboxGlobals = {
  console,
  setTimeout,
  setInterval,
  clearTimeout,
  clearInterval,
  JSON,
  Math,
  Date,
  RegExp,
  Error,
  TypeError,
  RangeError,
  parseInt,
  parseFloat,
  isNaN,
  isFinite,
  encodeURIComponent,
  decodeURIComponent,
  Array,
  Object,
  String,
  Number,
  Boolean,
  Map,
  Set,
  Promise,
  Symbol,
};

export function runInSandbox(jsCode: string, filename: string): void {
  vm.runInNewContext(jsCode, { ...sandboxGlobals }, { filename });
}
