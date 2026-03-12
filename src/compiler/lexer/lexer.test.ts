import { Lexer } from "@lexer/lexer";
import { TokenType } from "@language/tokens";

function assertEqual<T>(actual: T, expected: T, message?: string) {
  if (actual !== expected) {
    throw new Error(message ?? `Assertion failed: expected ${expected} but got ${actual}`);
  }
}

function assertDeepEqual<T>(actual: T, expected: T, message?: string) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) {
    throw new Error(message ?? `Assertion failed: expected ${b} but got ${a}`);
  }
}

function tokensOf(source: string) {
  const lexer = new Lexer(source);
  return lexer.tokenize();
}

function expectTypes(source: string, expected: TokenType[]) {
  const tokens = tokensOf(source).map((t) => t.type);
  assertDeepEqual(tokens, expected, `Unexpected token types for source: ${source}`);
}

// Test: comments and whitespace are skipped
expectTypes(
  "# comment\nfn sum(a,b) { a + b }",
  [
    TokenType.Keyword,
    TokenType.Identifier,
    TokenType.Delimiter,
    TokenType.Identifier,
    TokenType.Delimiter,
    TokenType.Identifier,
    TokenType.Delimiter,
    TokenType.Delimiter,
    TokenType.Identifier,
    TokenType.Operator,
    TokenType.Identifier,
    TokenType.Delimiter,
    TokenType.EOF,
  ]
);

// Test: one and two character operators, delimiters
expectTypes(
  "a==b a!=b a<=b a>=b 0..10 { } ( ) , + - * / = < > !",
  [
    TokenType.Identifier,
    TokenType.Operator,
    TokenType.Identifier,
    TokenType.Identifier,
    TokenType.Operator,
    TokenType.Identifier,
    TokenType.Identifier,
    TokenType.Operator,
    TokenType.Identifier,
    TokenType.Identifier,
    TokenType.Operator,
    TokenType.Identifier,
    TokenType.Number,
    TokenType.Operator,
    TokenType.Number,
    TokenType.Delimiter,
    TokenType.Delimiter,
    TokenType.Delimiter,
    TokenType.Delimiter,
    TokenType.Delimiter,
    TokenType.Operator,
    TokenType.Operator,
    TokenType.Operator,
    TokenType.Operator,
    TokenType.Operator,
    TokenType.Operator,
    TokenType.Operator,
    TokenType.EOF,
  ]
);

// Test: strings with braces are preserved
const stringTokens = tokensOf('print("Hello {name}")');
assertEqual(stringTokens[0].type, TokenType.Keyword);
assertEqual(stringTokens[1].type, TokenType.Delimiter); // (
assertEqual(stringTokens[2].type, TokenType.String);
assertEqual(stringTokens[2].value, "Hello {name}");
assertEqual(stringTokens[3].type, TokenType.Delimiter); // )
assertEqual(stringTokens[4].type, TokenType.EOF);

// Test: unterminated string throws
let threw = false;
try {
  tokensOf('"unterminated');
} catch (err) {
  threw = true;
  const msg = (err as Error).message;
  assertEqual(msg.includes("Unterminated string"), true, "Expected unterminated string error message");
}
assertEqual(threw, true, "Expected unterminated string to throw");

console.log("Lexer tests passed");
