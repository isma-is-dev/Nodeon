import { Token, TokenType } from "@language/tokens";
import {
  Program,
  Statement,
  FunctionDeclaration,
  VariableDeclaration,
  ExpressionStatement,
  Expression,
  CallExpression,
  BinaryExpression,
  UnaryExpression,
  Identifier,
  Literal,
  TemplateLiteral,
  TemplatePartText,
  TemplatePartExpression,
  IfStatement,
  ForStatement,
  WhileStatement,
  ReturnStatement,
  ImportDeclaration,
  ExportDeclaration,
  ClassDeclaration,
  ClassMethod,
  TryCatchStatement,
  ThrowStatement,
  MemberExpression,
  ArrayExpression,
  ObjectExpression,
  ObjectProperty,
  ArrowFunction,
  AssignmentExpression,
  NewExpression,
  AwaitExpression,
  SpreadExpression,
  Param,
} from "@ast/nodes";

const PRECEDENCE: Record<string, number> = {
  "..": 1,
  "||": 2,
  "&&": 3,
  "==": 4, "!=": 4,
  "<": 5, ">": 5, "<=": 5, ">=": 5,
  "+": 6, "-": 6,
  "*": 7, "/": 7, "%": 7,
};

export class Parser {
  private tokens: Token[] = [];
  private current = 0;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  parseProgram(): Program {
    const body: Statement[] = [];
    while (!this.isAtEnd()) {
      body.push(this.parseStatement());
    }
    return { type: "Program", body };
  }

  // ── Statement Parsing ──────────────────────────────────────────────

  private parseStatement(): Statement {
    const tok = this.peek();

    if (tok.type === TokenType.Keyword) {
      switch (tok.value) {
        case "fn": return this.parseFunctionDeclaration(false);
        case "async": return this.parseAsync();
        case "if": return this.parseIfStatement();
        case "for": return this.parseForStatement();
        case "while": return this.parseWhileStatement();
        case "return": return this.parseReturnStatement();
        case "import": return this.parseImportDeclaration();
        case "export": return this.parseExportDeclaration();
        case "class": return this.parseClassDeclaration();
        case "try": return this.parseTryCatch();
        case "throw": return this.parseThrowStatement();
        case "const": return this.parseConstDeclaration();
      }
    }

    if (tok.type === TokenType.Identifier) {
      const next = this.peekNext();
      if (next?.type === TokenType.Operator && next.value === "=") {
        const afterEq = this.peekAt(2);
        if (afterEq?.type !== TokenType.Operator || afterEq.value !== "=") {
          return this.parseVariableDeclaration(false);
        }
      }
    }

    return this.parseExpressionStatement();
  }

  private parseAsync(): Statement {
    this.consumeKeyword("async");
    const tok = this.peek();
    if (tok.type === TokenType.Keyword && tok.value === "fn") {
      return this.parseFunctionDeclaration(true);
    }
    this.error(tok, "Expected 'fn' after 'async'");
  }

  private parseFunctionDeclaration(isAsync: boolean): FunctionDeclaration {
    this.consumeKeyword("fn");
    const name = this.consumeIdentifier("Expected function name");
    this.consumeDelimiter("(", "Expected '('");
    const params = this.parseParamList();
    this.consumeDelimiter(")", "Expected ')'");

    // expression-style: fn sum(a,b) = a + b
    if (this.checkOperator("=")) {
      this.advance(); // consume =
      const expr = this.parseExpression();
      const body: Statement[] = [{ type: "ExpressionStatement", expression: expr }];
      return { type: "FunctionDeclaration", name, params, body, async: isAsync };
    }

    const body = this.parseBlock();
    return { type: "FunctionDeclaration", name, params, body, async: isAsync };
  }

  private parseParamList(): Param[] {
    const params: Param[] = [];
    if (this.checkDelimiter(")")) return params;
    do {
      let rest = false;
      if (this.checkOperator("...")) {
        this.advance();
        rest = true;
      }
      const tok = this.peek();
      if (tok.type !== TokenType.Identifier) this.error(tok, "Expected parameter name");
      this.advance();
      let defaultValue: Expression | undefined;
      if (this.checkOperator("=")) {
        this.advance();
        defaultValue = this.parseExpression();
      }
      params.push({ type: "Param", name: tok.value, defaultValue, rest });
    } while (this.matchDelimiter(","));
    return params;
  }

  private parseBlock(): Statement[] {
    this.consumeDelimiter("{", "Expected '{'");
    const statements: Statement[] = [];
    while (!this.checkDelimiter("}") && !this.isAtEnd()) {
      statements.push(this.parseStatement());
    }
    this.consumeDelimiter("}", "Expected '}'");
    return statements;
  }

  private parseIfStatement(): IfStatement {
    this.consumeKeyword("if");
    const condition = this.parseExpression();
    const consequent = this.parseBlock();
    let alternate: Statement[] | null = null;
    if (this.checkKeyword("else")) {
      this.advance();
      if (this.checkKeyword("if")) {
        alternate = [this.parseIfStatement()];
      } else {
        alternate = this.parseBlock();
      }
    }
    return { type: "IfStatement", condition, consequent, alternate };
  }

  private parseForStatement(): ForStatement {
    this.consumeKeyword("for");
    const variable = this.consumeIdentifier("Expected loop variable");
    this.consumeKeyword("in");
    const iterable = this.parseExpression();
    const body = this.parseBlock();
    return { type: "ForStatement", variable, iterable, body };
  }

  private parseWhileStatement(): WhileStatement {
    this.consumeKeyword("while");
    const condition = this.parseExpression();
    const body = this.parseBlock();
    return { type: "WhileStatement", condition, body };
  }

  private parseReturnStatement(): ReturnStatement {
    this.consumeKeyword("return");
    if (this.isAtEnd() || this.checkDelimiter("}")) {
      return { type: "ReturnStatement", value: null };
    }
    const value = this.parseExpression();
    return { type: "ReturnStatement", value };
  }

  private parseImportDeclaration(): ImportDeclaration {
    this.consumeKeyword("import");
    let defaultImport: string | null = null;
    const namedImports: string[] = [];

    if (this.checkDelimiter("{")) {
      this.advance();
      if (!this.checkDelimiter("}")) {
        do {
          const tok = this.peek();
          if (tok.type !== TokenType.Identifier) this.error(tok, "Expected import name");
          namedImports.push(tok.value);
          this.advance();
        } while (this.matchDelimiter(","));
      }
      this.consumeDelimiter("}", "Expected '}'");
    } else {
      const tok = this.peek();
      if (tok.type !== TokenType.Identifier) this.error(tok, "Expected module name");
      defaultImport = tok.value;
      this.advance();
    }

    this.consumeKeyword("from");
    const srcTok = this.peek();
    if (srcTok.type !== TokenType.String) this.error(srcTok, "Expected module source string");
    this.advance();
    return { type: "ImportDeclaration", defaultImport, namedImports, source: srcTok.value };
  }

  private parseExportDeclaration(): ExportDeclaration {
    this.consumeKeyword("export");
    const declaration = this.parseStatement();
    return { type: "ExportDeclaration", declaration };
  }

  private parseClassDeclaration(): ClassDeclaration {
    this.consumeKeyword("class");
    const name = this.consumeIdentifier("Expected class name");
    let superClass: Identifier | null = null;

    // class Foo extends Bar { ... }  →  we use < for extends to keep it clean
    // Actually let's support both 'extends' as identifier and '<' operator
    if (this.peek().type === TokenType.Identifier && this.peek().value === "extends") {
      this.advance();
      superClass = this.consumeIdentifier("Expected superclass name");
    }

    this.consumeDelimiter("{", "Expected '{'");
    const body: ClassMethod[] = [];

    while (!this.checkDelimiter("}") && !this.isAtEnd()) {
      let isAsync = false;
      if (this.checkKeyword("async")) {
        this.advance();
        isAsync = true;
      }

      // method name: could be 'fn methodName(...)' or just 'methodName(...)'
      if (this.checkKeyword("fn")) {
        this.advance();
      }

      const methodName = this.consumeIdentifier("Expected method name");
      this.consumeDelimiter("(", "Expected '('");
      const params = this.parseParamList();
      this.consumeDelimiter(")", "Expected ')'");
      const methodBody = this.parseBlock();
      body.push({ type: "ClassMethod", name: methodName, params, body: methodBody, async: isAsync });
    }

    this.consumeDelimiter("}", "Expected '}'");
    return { type: "ClassDeclaration", name, superClass, body };
  }

  private parseTryCatch(): TryCatchStatement {
    this.consumeKeyword("try");
    const tryBlock = this.parseBlock();
    this.consumeKeyword("catch");
    let catchParam: Identifier | null = null;
    if (this.checkDelimiter("(")) {
      this.advance();
      catchParam = this.consumeIdentifier("Expected catch parameter");
      this.consumeDelimiter(")", "Expected ')'");
    } else if (this.peek().type === TokenType.Identifier) {
      catchParam = this.consumeIdentifier("Expected catch parameter");
    }
    const catchBlock = this.parseBlock();
    return { type: "TryCatchStatement", tryBlock, catchParam, catchBlock };
  }

  private parseThrowStatement(): ThrowStatement {
    this.consumeKeyword("throw");
    const value = this.parseExpression();
    return { type: "ThrowStatement", value };
  }

  private parseConstDeclaration(): VariableDeclaration {
    this.consumeKeyword("const");
    return this.parseVariableDeclaration(true);
  }

  private parseVariableDeclaration(constant: boolean): VariableDeclaration {
    const name = this.consumeIdentifier("Expected variable name");
    this.consumeOperator("=", "Expected '=' in assignment");
    const value = this.parseExpression();
    return { type: "VariableDeclaration", name, value, constant };
  }

  private parseExpressionStatement(): ExpressionStatement {
    const expression = this.parseExpression();
    return { type: "ExpressionStatement", expression };
  }

  // ── Expression Parsing (Pratt) ─────────────────────────────────────

  private parseExpression(precedence = 0): Expression {
    let left = this.parseUnary();

    while (true) {
      const tok = this.peek();

      // Assignment: x = expr  (only when at top-level precedence)
      if (tok.type === TokenType.Operator && tok.value === "=" && precedence === 0) {
        if (left.type === "Identifier" || left.type === "MemberExpression") {
          this.advance();
          const right = this.parseExpression(0);
          left = { type: "AssignmentExpression", left, right } as AssignmentExpression;
          continue;
        }
      }

      // Binary operators
      if (tok.type === TokenType.Operator && PRECEDENCE[tok.value] !== undefined) {
        const opPrec = PRECEDENCE[tok.value];
        if (opPrec <= precedence) break;
        this.advance();
        const right = this.parseExpression(opPrec);
        left = { type: "BinaryExpression", operator: tok.value, left, right } as BinaryExpression;
        continue;
      }

      // Ternary: condition ? then : else
      if (tok.type === TokenType.Operator && tok.value === "?" && precedence === 0) {
        this.advance();
        const consequent = this.parseExpression();
        this.consumeDelimiter(":", "Expected ':' in ternary");
        const alternate = this.parseExpression();
        left = { type: "TernaryExpression", condition: left, consequent, alternate } as any;
        continue;
      }

      // Member access . and [
      if (tok.type === TokenType.Operator && tok.value === ".") {
        this.advance();
        const prop = this.consumeIdentifier("Expected property name");
        left = { type: "MemberExpression", object: left, property: prop, computed: false } as MemberExpression;
        // Check for call: obj.method(...)
        if (this.checkDelimiter("(")) {
          left = this.parseCallArguments(left);
        }
        continue;
      }

      if (tok.type === TokenType.Delimiter && tok.value === "[") {
        this.advance();
        const prop = this.parseExpression();
        this.consumeDelimiter("]", "Expected ']'");
        left = { type: "MemberExpression", object: left, property: prop, computed: true } as MemberExpression;
        continue;
      }

      // Function call: name(...)
      if (tok.type === TokenType.Delimiter && tok.value === "(") {
        if (left.type === "Identifier" || left.type === "MemberExpression") {
          left = this.parseCallArguments(left);
          continue;
        }
      }

      break;
    }

    return left;
  }

  private parseUnary(): Expression {
    const tok = this.peek();

    // await expr
    if (tok.type === TokenType.Keyword && tok.value === "await") {
      this.advance();
      const argument = this.parseUnary();
      return { type: "AwaitExpression", argument } as AwaitExpression;
    }

    // new Constructor(...)
    if (tok.type === TokenType.Keyword && tok.value === "new") {
      this.advance();
      let callee: Expression = this.consumeIdentifier("Expected constructor name");
      // support new Foo.Bar()
      while (this.checkOperator(".")) {
        this.advance();
        const prop = this.consumeIdentifier("Expected property name");
        callee = { type: "MemberExpression", object: callee, property: prop, computed: false } as MemberExpression;
      }
      const args: Expression[] = [];
      if (this.checkDelimiter("(")) {
        this.advance();
        if (!this.checkDelimiter(")")) {
          do { args.push(this.parseExpression()); } while (this.matchDelimiter(","));
        }
        this.consumeDelimiter(")", "Expected ')'");
      }
      return { type: "NewExpression", callee, arguments: args } as NewExpression;
    }

    // ...spread
    if (tok.type === TokenType.Operator && tok.value === "...") {
      this.advance();
      return { type: "SpreadExpression", argument: this.parseUnary() } as SpreadExpression;
    }

    // !expr or -expr (unary)
    if (tok.type === TokenType.Operator && (tok.value === "!" || tok.value === "-")) {
      this.advance();
      return { type: "UnaryExpression", operator: tok.value, argument: this.parseUnary() } as UnaryExpression;
    }

    return this.parsePrimary();
  }

  private parsePrimary(): Expression {
    const token = this.peek();

    // Grouped expression or arrow function: (params) => body
    if (token.type === TokenType.Delimiter && token.value === "(") {
      if (this.isArrowFunction()) {
        return this.parseArrowFunction(false);
      }
      this.advance();
      const expr = this.parseExpression();
      this.consumeDelimiter(")", "Expected ')'");
      return expr;
    }

    // Array literal: [a, b, c]
    if (token.type === TokenType.Delimiter && token.value === "[") {
      return this.parseArrayExpression();
    }

    // Object literal: { key: value }
    if (token.type === TokenType.Delimiter && token.value === "{") {
      return this.parseObjectExpression();
    }

    // Boolean literals
    if (token.type === TokenType.Keyword && (token.value === "true" || token.value === "false")) {
      this.advance();
      return { type: "Literal", value: token.value === "true", literalType: "boolean" } as Literal;
    }

    // null
    if (token.type === TokenType.Keyword && token.value === "null") {
      this.advance();
      return { type: "Literal", value: null, literalType: "null" } as Literal;
    }

    // Identifier or keyword used as identifier (print)
    if (token.type === TokenType.Identifier || (token.type === TokenType.Keyword && token.value === "print")) {
      this.advance();
      return { type: "Identifier", name: token.value } as Identifier;
    }

    // Number literal
    if (token.type === TokenType.Number) {
      this.advance();
      return { type: "Literal", value: Number(token.value), literalType: "number" } as Literal;
    }

    // String literal (with interpolation detection)
    if (token.type === TokenType.String) {
      this.advance();
      return this.parseStringLiteral(token.value);
    }

    this.error(token, "Expected expression");
  }

  private parseCallArguments(callee: Expression): CallExpression {
    this.consumeDelimiter("(", "Expected '('");
    const args: Expression[] = [];
    if (!this.checkDelimiter(")")) {
      do {
        args.push(this.parseExpression());
      } while (this.matchDelimiter(","));
    }
    this.consumeDelimiter(")", "Expected ')'");
    return { type: "CallExpression", callee, arguments: args };
  }

  private parseArrayExpression(): ArrayExpression {
    this.consumeDelimiter("[", "Expected '['");
    const elements: Expression[] = [];
    if (!this.checkDelimiter("]")) {
      do {
        elements.push(this.parseExpression());
      } while (this.matchDelimiter(","));
    }
    this.consumeDelimiter("]", "Expected ']'");
    return { type: "ArrayExpression", elements };
  }

  private parseObjectExpression(): ObjectExpression {
    this.consumeDelimiter("{", "Expected '{'");
    const properties: ObjectProperty[] = [];
    if (!this.checkDelimiter("}")) {
      do {
        const keyTok = this.peek();
        let key: Identifier | Literal;
        if (keyTok.type === TokenType.Identifier) {
          key = { type: "Identifier", name: keyTok.value };
          this.advance();
        } else if (keyTok.type === TokenType.String) {
          key = { type: "Literal", value: keyTok.value, literalType: "string" };
          this.advance();
        } else {
          this.error(keyTok, "Expected property key");
        }

        // Shorthand: { name } → { name: name }
        if (!this.checkDelimiter(":")) {
          properties.push({
            type: "ObjectProperty",
            key,
            value: { type: "Identifier", name: (key as Identifier).name },
            shorthand: true,
          });
        } else {
          this.advance(); // consume ':'
          const value = this.parseExpression();
          properties.push({ type: "ObjectProperty", key, value, shorthand: false });
        }
      } while (this.matchDelimiter(","));
    }
    this.consumeDelimiter("}", "Expected '}'");
    return { type: "ObjectExpression", properties };
  }

  private isArrowFunction(): boolean {
    // Save position and try to see if this is (params) => ...
    const saved = this.current;
    try {
      this.advance(); // skip (
      let depth = 1;
      while (depth > 0 && !this.isAtEnd()) {
        const t = this.advance();
        if (t.type === TokenType.Delimiter && t.value === "(") depth++;
        if (t.type === TokenType.Delimiter && t.value === ")") depth--;
      }
      const next = this.peek();
      return next.type === TokenType.Operator && next.value === "=>";
    } finally {
      this.current = saved;
    }
  }

  private parseArrowFunction(isAsync: boolean): ArrowFunction {
    this.consumeDelimiter("(", "Expected '('");
    const params = this.parseParamList();
    this.consumeDelimiter(")", "Expected ')'");
    this.consumeOperator("=>", "Expected '=>'");

    if (this.checkDelimiter("{")) {
      const body = this.parseBlock();
      return { type: "ArrowFunction", params, body, async: isAsync };
    }

    const expr = this.parseExpression();
    return { type: "ArrowFunction", params, body: expr, async: isAsync };
  }

  private parseStringLiteral(raw: string): Literal | TemplateLiteral {
    if (!raw.includes("{")) {
      return { type: "Literal", value: raw, literalType: "string" } as Literal;
    }

    const parts: Array<TemplatePartText | TemplatePartExpression> = [];
    let buffer = "";
    let i = 0;
    while (i < raw.length) {
      if (raw[i] === "{") {
        if (buffer) {
          parts.push({ kind: "Text", value: buffer });
          buffer = "";
        }
        let j = i + 1;
        let inner = "";
        let braceDepth = 1;
        while (j < raw.length && braceDepth > 0) {
          if (raw[j] === "{") braceDepth++;
          else if (raw[j] === "}") { braceDepth--; if (braceDepth === 0) break; }
          inner += raw[j];
          j++;
        }
        if (j >= raw.length) {
          throw new SyntaxError("Unterminated interpolation in string literal");
        }
        // Parse the inner expression using a sub-lexer + sub-parser
        const { Lexer } = require("@lexer/lexer");
        const innerTokens = new Lexer(inner).tokenize();
        const innerParser = new Parser(innerTokens);
        const expr = innerParser.parseExpression();
        parts.push({ kind: "Expression", expression: expr });
        i = j + 1;
        continue;
      }
      buffer += raw[i];
      i++;
    }
    if (buffer) {
      parts.push({ kind: "Text", value: buffer });
    }
    return { type: "TemplateLiteral", parts } as TemplateLiteral;
  }

  // ── Helpers ────────────────────────────────────────────────────────

  private checkKeyword(value: string): boolean {
    const tok = this.peek();
    return tok.type === TokenType.Keyword && tok.value === value;
  }

  private checkOperator(value: string): boolean {
    const tok = this.peek();
    return tok.type === TokenType.Operator && tok.value === value;
  }

  private consumeKeyword(value: string): void {
    const tok = this.peek();
    if (tok.type === TokenType.Keyword && tok.value === value) {
      this.advance();
      return;
    }
    this.error(tok, `Expected keyword '${value}'`);
  }

  private consumeIdentifier(message: string): Identifier {
    const tok = this.peek();
    if (tok.type === TokenType.Identifier) {
      this.advance();
      return { type: "Identifier", name: tok.value };
    }
    // Allow some keywords to be used as identifiers in certain contexts
    if (tok.type === TokenType.Keyword && ["print", "from", "async"].includes(tok.value)) {
      this.advance();
      return { type: "Identifier", name: tok.value };
    }
    this.error(tok, message);
  }

  private consumeDelimiter(value: string, message: string): void {
    const tok = this.peek();
    if (tok.type === TokenType.Delimiter && tok.value === value) {
      this.advance();
      return;
    }
    this.error(tok, message);
  }

  private consumeOperator(value: string, message: string): void {
    const tok = this.peek();
    if (tok.type === TokenType.Operator && tok.value === value) {
      this.advance();
      return;
    }
    this.error(tok, message);
  }

  private matchDelimiter(value: string): boolean {
    const tok = this.peek();
    if (tok.type === TokenType.Delimiter && tok.value === value) {
      this.advance();
      return true;
    }
    return false;
  }

  private checkDelimiter(value: string): boolean {
    const tok = this.peek();
    return tok.type === TokenType.Delimiter && tok.value === value;
  }

  private advance(): Token {
    if (!this.isAtEnd()) this.current++;
    return this.previous();
  }

  private peek(): Token {
    return this.tokens[this.current];
  }

  private peekNext(): Token | undefined {
    return this.tokens[this.current + 1];
  }

  private peekAt(offset: number): Token | undefined {
    return this.tokens[this.current + offset];
  }

  private previous(): Token {
    return this.tokens[this.current - 1];
  }

  private isAtEnd(): boolean {
    return this.peek().type === TokenType.EOF;
  }

  private error(token: Token, message: string): never {
    throw new SyntaxError(`${message} at position ${token.position}`);
  }
}
