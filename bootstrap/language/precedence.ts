/**
 * Shared operator precedence table.
 * Used by both the parser and the JS code generator.
 */
export const PRECEDENCE: Record<string, number> = {
  "|>": 1,
  "..": 1,
  "??": 2,
  "||": 3,
  "&&": 4,
  "|": 5,
  "^": 6,
  "&": 7,
  "==": 8, "!=": 8, "===": 8, "!==": 8,
  "<": 9, ">": 9, "<=": 9, ">=": 9, "instanceof": 9, "in": 9,
  "<<": 10, ">>": 10, ">>>": 10,
  "+": 11, "-": 11,
  "*": 12, "/": 12, "%": 12,
  "**": 13,
};

export const COMPOUND_ASSIGN = new Set([
  "+=", "-=", "*=", "/=", "%=", "**=",
  "&&=", "||=", "??=",
  "<<=", ">>=", ">>>=",
  "&=", "|=", "^=",
]);
