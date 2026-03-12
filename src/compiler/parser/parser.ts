import { Token, TokenType } from "@language/tokens";
import { Lexer } from "@lexer/lexer";
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
  UpdateExpression,
  Identifier,
  Literal,
  TemplateLiteral,
  TemplatePartText,
  TemplatePartExpression,
  IfStatement,
  ForStatement,
  WhileStatement,
  DoWhileStatement,
  ReturnStatement,
  ImportDeclaration,
  ExportDeclaration,
  ClassDeclaration,
  ClassMethod,
  TryCatchStatement,
  ThrowStatement,
  SwitchStatement,
  SwitchCase,
  BreakStatement,
  ContinueStatement,
  DebuggerStatement,
  MemberExpression,
  ArrayExpression,
  ObjectExpression,
  ObjectProperty,
  ArrowFunction,
  AssignmentExpression,
  CompoundAssignmentExpression,
  NewExpression,
  AwaitExpression,
  SpreadExpression,
  TernaryExpression,
  TypeofExpression,
  VoidExpression,
  DeleteExpression,
  YieldExpression,
  Param,
  DestructuringDeclaration,
  ObjectPattern,
  ObjectPatternProperty,
  ArrayPattern,
} from "@ast/nodes";

const PRECEDENCE: Record<string, number> = {
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
  "|>": 13,
};

const COMPOUND_ASSIGN = new Set([
  "+=", "-=", "*=", "/=", "%=", "**=",
  "&&=", "||=", "??=",
]);

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
        case "do": return this.parseDoWhileStatement();
        case "return": return this.parseReturnStatement();
        case "import": return this.parseImportDeclaration();
        case "export": return this.parseExportDeclaration();
        case "class": return this.parseClassDeclaration();
        case "try": return this.parseTryCatch();
        case "throw": return this.parseThrowStatement();
        case "const": return this.parseConstDeclaration();
        case "let": return this.parseLetDeclaration();
        case "var": return this.parseVarDeclaration();
        case "switch": return this.parseSwitchStatement();
        case "break": { this.advance(); return { type: "BreakStatement" } as BreakStatement; }
        case "continue": { this.advance(); return { type: "ContinueStatement" } as ContinueStatement; }
        case "debugger": { this.advance(); return { type: "DebuggerStatement" } as DebuggerStatement; }
      }
    }

    if (tok.type === TokenType.Identifier) {
      const next = this.peekNext();
      if (next?.type === TokenType.Operator && next.value === "=") {
        const afterEq = this.peekAt(2);
        if (afterEq?.type !== TokenType.Operator || (afterEq.value !== "=" && afterEq.value !== ">")) {
          return this.parseVariableDeclaration("let");
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
      // Destructuring param: fn process({ name, age }) { ... }
      if (this.checkDelimiter("{")) {
        const pattern = this.parseObjectPattern();
        let defaultValue: Expression | undefined;
        if (this.checkOperator("=")) {
          this.advance();
          defaultValue = this.parseExpression();
        }
        params.push({ type: "Param", name: "__destructured", pattern, defaultValue, rest });
        continue;
      }
      if (this.checkDelimiter("[")) {
        const pattern = this.parseArrayPattern();
        let defaultValue: Expression | undefined;
        if (this.checkOperator("=")) {
          this.advance();
          defaultValue = this.parseExpression();
        }
        params.push({ type: "Param", name: "__destructured", pattern, defaultValue, rest });
        continue;
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
    let variable: Identifier | ObjectPattern | ArrayPattern;
    if (this.checkDelimiter("{")) {
      variable = this.parseObjectPattern();
    } else if (this.checkDelimiter("[")) {
      variable = this.parseArrayPattern();
    } else {
      variable = this.consumeIdentifier("Expected loop variable");
    }
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

  private parseDoWhileStatement(): DoWhileStatement {
    this.consumeKeyword("do");
    const body = this.parseBlock();
    this.consumeKeyword("while");
    const condition = this.parseExpression();
    return { type: "DoWhileStatement", condition, body };
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
    } else if (this.checkOperator("*")) {
      // import * as name from "module"
      this.advance(); // *
      // consume 'as' — it's an identifier, not a keyword
      const asTok = this.peek();
      if (asTok.type === TokenType.Identifier && asTok.value === "as") {
        this.advance();
      } else {
        this.error(asTok, "Expected 'as' after '*'");
      }
      const tok = this.peek();
      if (tok.type !== TokenType.Identifier) this.error(tok, "Expected module name");
      defaultImport = `* as ${tok.value}`;
      this.advance();
    } else {
      const tok = this.peek();
      if (tok.type !== TokenType.Identifier) this.error(tok, "Expected module name");
      defaultImport = tok.value;
      this.advance();
    }

    this.consumeKeyword("from");
    const srcTok = this.peek();
    if (srcTok.type !== TokenType.String && srcTok.type !== TokenType.RawString) {
      this.error(srcTok, "Expected module source string");
    }
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

    if (this.checkKeyword("extends")) {
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

    let catchParam: Identifier | null = null;
    let catchBlock: Statement[] = [];
    let finallyBlock: Statement[] | null = null;

    if (this.checkKeyword("catch")) {
      this.consumeKeyword("catch");
      if (this.checkDelimiter("(")) {
        this.advance();
        catchParam = this.consumeIdentifier("Expected catch parameter");
        this.consumeDelimiter(")", "Expected ')'");
      } else if (this.peek().type === TokenType.Identifier) {
        catchParam = this.consumeIdentifier("Expected catch parameter");
      }
      catchBlock = this.parseBlock();
    }

    if (this.checkKeyword("finally")) {
      this.advance();
      finallyBlock = this.parseBlock();
    }

    return { type: "TryCatchStatement", tryBlock, catchParam, catchBlock, finallyBlock };
  }

  private parseThrowStatement(): ThrowStatement {
    this.consumeKeyword("throw");
    const value = this.parseExpression();
    return { type: "ThrowStatement", value };
  }

  private parseConstDeclaration(): VariableDeclaration | DestructuringDeclaration {
    this.consumeKeyword("const");
    return this.parseVariableOrDestructuring("const");
  }

  private parseLetDeclaration(): VariableDeclaration | DestructuringDeclaration {
    this.consumeKeyword("let");
    return this.parseVariableOrDestructuring("let");
  }

  private parseVarDeclaration(): VariableDeclaration | DestructuringDeclaration {
    this.consumeKeyword("var");
    return this.parseVariableOrDestructuring("var");
  }

  private parseVariableOrDestructuring(kind: "let" | "const" | "var"): VariableDeclaration | DestructuringDeclaration {
    // Check for destructuring: { a, b } = ... or [x, y] = ...
    if (this.checkDelimiter("{")) {
      const pattern = this.parseObjectPattern();
      this.consumeOperator("=", "Expected '=' after destructuring pattern");
      const value = this.parseExpression();
      return { type: "DestructuringDeclaration", pattern, value, kind };
    }
    if (this.checkDelimiter("[")) {
      const pattern = this.parseArrayPattern();
      this.consumeOperator("=", "Expected '=' after destructuring pattern");
      const value = this.parseExpression();
      return { type: "DestructuringDeclaration", pattern, value, kind };
    }
    return this.parseVariableDeclaration(kind);
  }

  private parseVariableDeclaration(kind: "let" | "const" | "var"): VariableDeclaration {
    const name = this.consumeIdentifier("Expected variable name");
    this.consumeOperator("=", "Expected '=' in assignment");
    const value = this.parseExpression();
    return { type: "VariableDeclaration", name, value, kind };
  }

  private parseSwitchStatement(): SwitchStatement {
    this.consumeKeyword("switch");
    const discriminant = this.parseExpression();
    this.consumeDelimiter("{", "Expected '{'");
    const cases: SwitchCase[] = [];

    while (!this.checkDelimiter("}") && !this.isAtEnd()) {
      if (this.checkKeyword("case")) {
        this.advance();
        const test = this.parseExpression();
        this.consumeDelimiter("{", "Expected '{'");
        const consequent: Statement[] = [];
        while (!this.checkDelimiter("}") && !this.isAtEnd()) {
          consequent.push(this.parseStatement());
        }
        this.consumeDelimiter("}", "Expected '}'");
        cases.push({ type: "SwitchCase", test, consequent });
      } else if (this.checkKeyword("default")) {
        this.advance();
        this.consumeDelimiter("{", "Expected '{'");
        const consequent: Statement[] = [];
        while (!this.checkDelimiter("}") && !this.isAtEnd()) {
          consequent.push(this.parseStatement());
        }
        this.consumeDelimiter("}", "Expected '}'");
        cases.push({ type: "SwitchCase", test: null, consequent });
      } else {
        this.error(this.peek(), "Expected 'case' or 'default'");
      }
    }

    this.consumeDelimiter("}", "Expected '}'");
    return { type: "SwitchStatement", discriminant, cases };
  }

  private parseExpressionStatement(): ExpressionStatement {
    const expression = this.parseExpression();
    return { type: "ExpressionStatement", expression };
  }

  // ── Expression Parsing (Pratt) ─────────────────────────────────────

  parseExpression(precedence = 0): Expression {
    let left = this.parseUnary();

    while (true) {
      const tok = this.peek();

      // Compound assignment: +=, -=, *=, /=, etc.
      if (tok.type === TokenType.Operator && COMPOUND_ASSIGN.has(tok.value) && precedence === 0) {
        if (left.type === "Identifier" || left.type === "MemberExpression") {
          this.advance();
          const right = this.parseExpression(0);
          left = { type: "CompoundAssignmentExpression", operator: tok.value, left, right } as CompoundAssignmentExpression;
          continue;
        }
      }

      // Assignment: x = expr (only when at top-level precedence)
      if (tok.type === TokenType.Operator && tok.value === "=" && precedence === 0) {
        if (left.type === "Identifier" || left.type === "MemberExpression") {
          this.advance();
          const right = this.parseExpression(0);
          left = { type: "AssignmentExpression", left, right } as AssignmentExpression;
          continue;
        }
      }

      // Postfix ++ and --
      if (tok.type === TokenType.Operator && (tok.value === "++" || tok.value === "--")) {
        if (left.type === "Identifier" || left.type === "MemberExpression") {
          this.advance();
          left = { type: "UpdateExpression", operator: tok.value as "++" | "--", argument: left, prefix: false } as UpdateExpression;
          continue;
        }
      }

      // Binary operators
      if (tok.type === TokenType.Operator && PRECEDENCE[tok.value] !== undefined) {
        const opPrec = PRECEDENCE[tok.value];
        if (opPrec <= precedence) break;
        this.advance();
        const right = this.parseExpression(tok.value === "**" ? opPrec - 1 : opPrec); // ** is right-associative
        left = { type: "BinaryExpression", operator: tok.value, left, right } as BinaryExpression;
        continue;
      }

      // instanceof as binary operator (keyword)
      if (tok.type === TokenType.Keyword && tok.value === "instanceof") {
        const opPrec = PRECEDENCE["instanceof"];
        if (opPrec <= precedence) break;
        this.advance();
        const right = this.parseExpression(opPrec);
        left = { type: "BinaryExpression", operator: "instanceof", left, right } as BinaryExpression;
        continue;
      }

      // Ternary: condition ? then : else
      if (tok.type === TokenType.Operator && tok.value === "?" && precedence === 0) {
        // Check it's not ?. (optional chaining) — already handled below
        const next = this.peekNext();
        if (next && next.type === TokenType.Operator && next.value === ".") break; // let member access handle it
        this.advance();
        const consequent = this.parseExpression();
        this.consumeDelimiter(":", "Expected ':' in ternary");
        const alternate = this.parseExpression();
        left = { type: "TernaryExpression", condition: left, consequent, alternate } as TernaryExpression;
        continue;
      }

      // Member access . and ?.
      if (tok.type === TokenType.Operator && (tok.value === "." || tok.value === "?.")) {
        const optional = tok.value === "?.";
        this.advance();
        const prop = this.consumeIdentifier("Expected property name");
        left = { type: "MemberExpression", object: left, property: prop, computed: false, optional } as MemberExpression;
        // Check for call: obj.method(...)
        if (this.checkDelimiter("(")) {
          left = this.parseCallArguments(left);
        }
        continue;
      }

      // Computed member access [
      if (tok.type === TokenType.Delimiter && tok.value === "[") {
        this.advance();
        const prop = this.parseExpression();
        this.consumeDelimiter("]", "Expected ']'");
        left = { type: "MemberExpression", object: left, property: prop, computed: true, optional: false } as MemberExpression;
        continue;
      }

      // Function call: name(...)
      if (tok.type === TokenType.Delimiter && tok.value === "(") {
        if (left.type === "Identifier" || left.type === "MemberExpression" || left.type === "CallExpression") {
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

    // typeof expr
    if (tok.type === TokenType.Keyword && tok.value === "typeof") {
      this.advance();
      const argument = this.parseUnary();
      return { type: "TypeofExpression", argument } as TypeofExpression;
    }

    // void expr
    if (tok.type === TokenType.Keyword && tok.value === "void") {
      this.advance();
      const argument = this.parseUnary();
      return { type: "VoidExpression", argument } as VoidExpression;
    }

    // delete expr
    if (tok.type === TokenType.Keyword && tok.value === "delete") {
      this.advance();
      const argument = this.parseUnary();
      return { type: "DeleteExpression", argument } as DeleteExpression;
    }

    // yield / yield*
    if (tok.type === TokenType.Keyword && tok.value === "yield") {
      this.advance();
      let delegate = false;
      if (this.checkOperator("*")) {
        this.advance();
        delegate = true;
      }
      if (this.isAtEnd() || this.checkDelimiter("}") || this.checkDelimiter(")")) {
        return { type: "YieldExpression", argument: null, delegate } as YieldExpression;
      }
      const argument = this.parseExpression();
      return { type: "YieldExpression", argument, delegate } as YieldExpression;
    }

    // new Constructor(...)
    if (tok.type === TokenType.Keyword && tok.value === "new") {
      this.advance();
      let callee: Expression = this.consumeIdentifier("Expected constructor name");
      // support new Foo.Bar()
      while (this.checkOperator(".")) {
        this.advance();
        const prop = this.consumeIdentifier("Expected property name");
        callee = { type: "MemberExpression", object: callee, property: prop, computed: false, optional: false } as MemberExpression;
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

    // Prefix ++ and --
    if (tok.type === TokenType.Operator && (tok.value === "++" || tok.value === "--")) {
      this.advance();
      const argument = this.parseUnary();
      return { type: "UpdateExpression", operator: tok.value as "++" | "--", argument, prefix: true } as UpdateExpression;
    }

    // !expr, -expr, ~expr, +expr (unary)
    if (tok.type === TokenType.Operator && (tok.value === "!" || tok.value === "-" || tok.value === "~" || tok.value === "+")) {
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

    // undefined
    if (token.type === TokenType.Keyword && token.value === "undefined") {
      this.advance();
      return { type: "Literal", value: undefined, literalType: "undefined" } as Literal;
    }

    // this
    if (token.type === TokenType.Keyword && token.value === "this") {
      this.advance();
      return { type: "Identifier", name: "this" } as Identifier;
    }

    // super
    if (token.type === TokenType.Keyword && token.value === "super") {
      this.advance();
      return { type: "Identifier", name: "super" } as Identifier;
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

    // Raw string literal (single-quoted, no interpolation)
    if (token.type === TokenType.RawString) {
      this.advance();
      return { type: "Literal", value: token.value, literalType: "string" } as Literal;
    }

    // String literal (double-quoted, with interpolation detection)
    if (token.type === TokenType.String) {
      this.advance();
      return this.parseStringLiteral(token.value);
    }

    // Template literal from lexer (backtick strings)
    if (token.type === TokenType.TemplateLiteral) {
      this.advance();
      return this.parseTemplateLiteral(token.value);
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
        if (keyTok.type === TokenType.Identifier || (keyTok.type === TokenType.Keyword)) {
          key = { type: "Identifier", name: keyTok.value };
          this.advance();
        } else if (keyTok.type === TokenType.String || keyTok.type === TokenType.RawString) {
          key = { type: "Literal", value: keyTok.value, literalType: "string" };
          this.advance();
        } else if (keyTok.type === TokenType.Number) {
          key = { type: "Literal", value: Number(keyTok.value), literalType: "number" };
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

  // Nodeon-style string interpolation: "Hello {name}" → template literal
  private parseStringLiteral(raw: string): Literal | TemplateLiteral {
    if (!raw.includes("{")) {
      return { type: "Literal", value: raw, literalType: "string" } as Literal;
    }

    const parts: Array<TemplatePartText | TemplatePartExpression> = [];
    let buffer = "";
    let i = 0;
    while (i < raw.length) {
      if (raw[i] === "\\") {
        // escaped brace — keep the literal char
        if (i + 1 < raw.length && raw[i + 1] === "{") {
          buffer += "{";
          i += 2;
          continue;
        }
      }
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

  // JS-style template literal: `Hello ${name}` from backtick tokens
  private parseTemplateLiteral(raw: string): TemplateLiteral {
    const parts: Array<TemplatePartText | TemplatePartExpression> = [];
    let buffer = "";
    let i = 0;
    while (i < raw.length) {
      if (raw[i] === "$" && i + 1 < raw.length && raw[i + 1] === "{") {
        if (buffer) {
          parts.push({ kind: "Text", value: buffer });
          buffer = "";
        }
        i += 2; // skip ${
        let inner = "";
        let braceDepth = 1;
        while (i < raw.length && braceDepth > 0) {
          if (raw[i] === "{") braceDepth++;
          else if (raw[i] === "}") { braceDepth--; if (braceDepth === 0) break; }
          inner += raw[i];
          i++;
        }
        i++; // skip closing }
        const innerTokens = new Lexer(inner).tokenize();
        const innerParser = new Parser(innerTokens);
        const expr = innerParser.parseExpression();
        parts.push({ kind: "Expression", expression: expr });
        continue;
      }
      buffer += raw[i];
      i++;
    }
    if (buffer) {
      parts.push({ kind: "Text", value: buffer });
    }
    if (parts.length === 0) {
      parts.push({ kind: "Text", value: "" });
    }
    return { type: "TemplateLiteral", parts };
  }

  // ── Destructuring Patterns ────────────────────────────────────────

  private parseObjectPattern(): ObjectPattern {
    this.consumeDelimiter("{", "Expected '{'");
    const properties: ObjectPatternProperty[] = [];
    let rest: Identifier | undefined;

    while (!this.checkDelimiter("}") && !this.isAtEnd()) {
      // ...rest
      if (this.checkOperator("...")) {
        this.advance();
        rest = this.consumeIdentifier("Expected rest identifier");
        break;
      }

      const key = this.consumeIdentifier("Expected property name");
      let value: Identifier | ObjectPattern | ArrayPattern = key;
      let shorthand = true;
      let defaultValue: Expression | undefined;

      // { key: alias } or { key: { nested } } or { key: [nested] }
      if (this.checkDelimiter(":")) {
        this.advance();
        shorthand = false;
        if (this.checkDelimiter("{")) {
          value = this.parseObjectPattern();
        } else if (this.checkDelimiter("[")) {
          value = this.parseArrayPattern();
        } else {
          value = this.consumeIdentifier("Expected alias name");
        }
      }

      // { key = defaultValue }
      if (this.checkOperator("=")) {
        this.advance();
        defaultValue = this.parseExpression();
      }

      properties.push({ type: "ObjectPatternProperty", key, value, shorthand, defaultValue });

      if (!this.matchDelimiter(",")) break;
    }

    this.consumeDelimiter("}", "Expected '}'");
    return { type: "ObjectPattern", properties, rest };
  }

  private parseArrayPattern(): ArrayPattern {
    this.consumeDelimiter("[", "Expected '['");
    const elements: Array<Identifier | ObjectPattern | ArrayPattern | null> = [];
    let rest: Identifier | undefined;

    while (!this.checkDelimiter("]") && !this.isAtEnd()) {
      // ...rest
      if (this.checkOperator("...")) {
        this.advance();
        rest = this.consumeIdentifier("Expected rest identifier");
        break;
      }

      // Holes: [, , x]
      if (this.checkDelimiter(",")) {
        elements.push(null);
        this.advance();
        continue;
      }

      // Nested destructuring
      if (this.checkDelimiter("{")) {
        elements.push(this.parseObjectPattern());
      } else if (this.checkDelimiter("[")) {
        elements.push(this.parseArrayPattern());
      } else {
        elements.push(this.consumeIdentifier("Expected element name"));
      }

      if (!this.matchDelimiter(",")) break;
    }

    this.consumeDelimiter("]", "Expected ']'");
    return { type: "ArrayPattern", elements, rest };
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
    if (tok.type === TokenType.Keyword && ["print", "from", "async", "of", "get", "set"].includes(tok.value)) {
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
    const loc = token.loc;
    if (loc) {
      throw new SyntaxError(`${message} at ${loc.line}:${loc.column}`);
    }
    throw new SyntaxError(`${message} at position ${token.position}`);
  }
}
