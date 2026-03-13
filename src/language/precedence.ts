/**
 * Shared operator precedence table.
 * Used by both the parser and the JS code generator.
 */
export const PRECEDENCE: Record<string, number> = {
  "|>": 1,
  "..": 1,
  "??": 2,
  "||": 3,
  "&&": 3,
  "|": 4,
  "^": 5,
  "&": 6,
  "==": 7, "!=": 7, "===": 7, "!==": 7,
  "<": 8, ">": 8, "<=": 8, ">=": 8, "instanceof": 8,
  "<<": 9, ">>": 9, ">>>": 9,
  "+": 10, "-": 10,
  "*": 11, "/": 11, "%": 11,
  "**": 12,
};

export const COMPOUND_ASSIGN = new Set([
  "+=", "-=", "*=", "/=", "%=", "**=",
  "&&=", "||=", "??=",
  "<<=", ">>=", ">>>=",
  "&=", "|=", "^=",
]);
