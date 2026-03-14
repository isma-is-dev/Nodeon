import { describe, it, expect } from "vitest";
import { compile } from "@compiler/compile";
import { readFileSync } from "fs";
import { resolve } from "path";

const FIXTURES_DIR = resolve(__dirname, "fixtures");

function loadFixture(name: string): string {
  return readFileSync(resolve(FIXTURES_DIR, name), "utf8");
}

function compileFixture(name: string): string {
  const source = loadFixture(name);
  return compile(source).js;
}

describe("snapshot tests", () => {
  it("variables.no", () => {
    expect(compileFixture("variables.no")).toMatchSnapshot();
  });

  it("functions.no", () => {
    expect(compileFixture("functions.no")).toMatchSnapshot();
  });

  it("classes.no", () => {
    expect(compileFixture("classes.no")).toMatchSnapshot();
  });

  it("control-flow.no", () => {
    expect(compileFixture("control-flow.no")).toMatchSnapshot();
  });

  it("types.no", () => {
    expect(compileFixture("types.no")).toMatchSnapshot();
  });
});
