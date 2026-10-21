import { Token, TokenType } from "@language/tokens";
import { Lexer } from "@lexer/lexer";
import { PRECEDENCE, COMPOUND_ASSIGN } from "@language/precedence";
import { ParserBase } from "./parser-base";
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
  ClassField,
  RegExpLiteral,
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
  TypeAnnotation,
  MatchStatement,
  MatchCase,
  EnumDeclaration,
  EnumMember,
  InterfaceDeclaration,
  InterfaceProperty,
  TypeAliasDeclaration,
  ImportSpecifier,
  ExportSpecifier,
  LabeledStatement,
  AsExpression,
  IfExpression,
  Decorator,
  NamedArgument,
  ADTDeclaration,
  ADTVariant,
  ADTField,
} from "@ast/nodes";

// PRECEDENCE and COMPOUND_ASSIGN imported from @language/precedence

/**
 * Build a numeric literal from a Number token.
 *
 * The lexer normalises `value` to a plain base-10 string for every literal, so
 * `Number(value)` is correct for hex, binary, octal, legacy octal and
 * underscore-separated numbers. BigInt is the exception: the `n` suffix cannot
 * survive `Number()`, and `Number("123n")` is NaN — a silently wrong constant
 * with no diagnostic. For those, parse from `raw` and mark the literal so the
 * generator re-emits the suffix.
 */
function numberLiteral(token: any): { type: "Literal"; value: number | bigint; literalType: string; bigint?: boolean } {
  if (token.bigint) {
    try {
      return {
        type: "Literal",
        value: BigInt(String(token.raw ?? token.value).replace(/n$/, "")),
        literalType: "bigint",
        bigint: true,
      } as any;
    } catch {
      // Malformed BigInt: fall through to the numeric reading so the error
      // surfaces as a value rather than throwing out of the parser.
    }
  }
  return { type: "Literal", value: Number(token.value), literalType: "number" } as any;
}

export class Parser extends ParserBase {
  constructor(tokens: Token[], source?: string) {
    super(tokens, source);
  }

  public errors: SyntaxError[] = [];

  // Names bound by a declaration seen so far. A bare `x = v` declares on
  // first use and assigns afterwards; this is what distinguishes the two.
  private boundNames = new Set<string>();

  parseProgram(): Program {
    const body: Statement[] = [];
    while (!this.isAtEnd()) {
      const before = this.current;
      try {
        body.push(this.parseStatement());
      } catch (err: any) {
        if (err instanceof SyntaxError) {
          this.errors.push(err);
          // Skip to next statement boundary for recovery
          this.recover();
          // recover() may legitimately stop *without* consuming a token (it hands
          // control back at a `}` or a statement keyword). If the failed statement
          // is what sits at that boundary, the next iteration would fail at the
          // same position forever, pushing identical errors until the heap dies.
          // Force progress so a syntax error can never hang or OOM the compiler.
          if (this.current === before) {
            this.advance();
          }
          // Keep a placeholder so the enclosing function is not silently
          // deleted. Without this, one bad statement inside `fn f() { ... }`
          // unwound every nested frame and the whole function vanished from
          // the output while the error was only recorded, not enforced.
          body.push({ type: "ErrorStatement", message: err.message } as any);
        } else {
          throw err;
        }
      }
    }
    return { type: "Program", body, errors: this.errors } as any;
  }

  private recover(): void {
    let braceDepth = 0;
    while (!this.isAtEnd()) {
      const tok = this.peek();

      // Track brace depth so we don't skip past closing braces of outer scopes
      if (tok.type === TokenType.Delimiter && tok.value === "{") {
        braceDepth++;
        this.advance();
        continue;
      }
      if (tok.type === TokenType.Delimiter && tok.value === "}") {
        if (braceDepth > 0) {
          braceDepth--;
          this.advance();
          continue;
        }
        // At depth 0, stop before the } — let the caller handle it
        return;
      }

      // Semicolons at depth 0 are valid recovery points
      if (tok.type === TokenType.Delimiter && tok.value === ";" && braceDepth === 0) {
        this.advance();
        return;
      }

      // Statement-starting keywords at depth 0 — stop and let parser try again
      if (braceDepth === 0 && tok.type === TokenType.Keyword && [
        "fn", "if", "for", "while", "do", "return", "import", "export",
        "class", "try", "throw", "const", "let", "var", "switch", "match",
        "enum", "interface", "break", "continue"
      ].includes(tok.value)) {
        return; // Don't consume — let the parser try parsing this as a new statement
      }

      this.advance();
    }
  }

  // ── Statement Parsing ──────────────────────────────────────────────

  private parseDecorators(): Decorator[] {
    const decorators: Decorator[] = [];
    while (this.peek().type === TokenType.Decorator) {
      const tok = this.advance();
      const name = tok.value.slice(1); // remove @
      let args: Expression[] | undefined;
      if (this.checkDelimiter("(")) {
        this.advance();
        args = [];
        if (!this.checkDelimiter(")")) {
          do { args.push(this.parseExpression()); } while (this.matchDelimiter(","));
        }
        this.consumeDelimiter(")", "Expected ')' after decorator arguments");
      }
      decorators.push({ type: "Decorator", name, arguments: args });
    }
    return decorators;
  }

  private parseStatement(): Statement {
    // Collect decorators before the statement
    const decorators = this.parseDecorators();

    const tok = this.peek();
    const loc = tok.loc ? { line: tok.loc.line, column: tok.loc.column } : undefined;

    let stmt: Statement;

    if (tok.type === TokenType.Keyword) {
      switch (tok.value) {
        case "fn": {
          // Check for fn* (generator)
          const next = this.peekNext();
          stmt = this.parseFunctionDeclaration(false, next?.type === TokenType.Operator && next?.value === "*");
          break;
        }
        case "async": stmt = this.parseAsync(); break;
        case "if": stmt = this.parseIfStatement(); break;
        case "for": stmt = this.parseForStatement(); break;
        case "while": stmt = this.parseWhileStatement(); break;
        case "do": stmt = this.parseDoWhileStatement(); break;
        case "return": stmt = this.parseReturnStatement(); break;
        case "import": stmt = this.parseImportDeclaration(); break;
        case "export": stmt = this.parseExportDeclaration(); break;
        case "class": stmt = this.parseClassDeclaration(); break;
        case "try": stmt = this.parseTryCatch(); break;
        case "throw": stmt = this.parseThrowStatement(); break;
        case "const": stmt = this.parseConstDeclaration(); break;
        case "let": stmt = this.parseLetDeclaration(); break;
        case "var": stmt = this.parseVarDeclaration(); break;
        case "switch": stmt = this.parseSwitchStatement(); break;
        case "match": stmt = this.parseMatchStatement(); break;
        case "enum": stmt = this.parseEnumDeclaration(); break;
        case "interface": stmt = this.parseInterfaceDeclaration(); break;
        case "break": {
          this.advance();
          let label: string | undefined;
          if (this.peek().type === TokenType.Identifier) {
            label = this.peek().value;
            this.advance();
          }
          stmt = { type: "BreakStatement", label } as BreakStatement;
          break;
        }
        case "continue": {
          this.advance();
          let label: string | undefined;
          if (this.peek().type === TokenType.Identifier) {
            label = this.peek().value;
            this.advance();
          }
          stmt = { type: "ContinueStatement", label } as ContinueStatement;
          break;
        }
        case "debugger": this.advance(); stmt = { type: "DebuggerStatement" } as DebuggerStatement; break;
        case "go": stmt = this.parseGoStatement(); break;
        default: stmt = this.parseExpressionStatement(); break;
      }
    } else if (tok.type === TokenType.Identifier) {
      // Contextual keyword: type Foo = ...
      if (tok.value === "type" && this.peekNext()?.type === TokenType.Identifier) {
        stmt = this.parseTypeOrADT();
        if (loc) stmt.loc = loc;
        return stmt;
      }
      const next = this.peekNext();
      // Labeled statement: label: for/while/do
      if (next?.type === TokenType.Delimiter && next.value === ":") {
        const after = this.peekAt(2);
        if (after?.type === TokenType.Keyword && (after.value === "for" || after.value === "while" || after.value === "do")) {
          const label = tok.value;
          this.advance(); // consume label
          this.advance(); // consume :
          const body = this.parseStatement();
          stmt = { type: "LabeledStatement", label, body } as LabeledStatement;
        } else {
          // Bare typed declaration: x: Type = value  (implicit let)
          stmt = this.parseIdentifierStatement(tok, next);
        }
      } else {
        stmt = this.parseIdentifierStatement(tok, next);
      }
    } else {
      stmt = this.parseExpressionStatement();
    }

    // Attach decorators to supported declarations
    if (decorators.length > 0) {
      if (stmt.type === "FunctionDeclaration") {
        stmt.decorators = decorators;
      } else if (stmt.type === "ClassDeclaration") {
        stmt.decorators = decorators;
      } else if (stmt.type === "ExportDeclaration" && stmt.declaration) {
        if (stmt.declaration.type === "FunctionDeclaration") {
          (stmt.declaration as FunctionDeclaration).decorators = decorators;
        } else if (stmt.declaration.type === "ClassDeclaration") {
          (stmt.declaration as ClassDeclaration).decorators = decorators;
        }
      }
    }

    if (loc) stmt.loc = loc;
    return stmt;
  }

  private parseIdentifierStatement(tok: Token, next: Token | undefined): Statement {
    // Bare assignment: x = value (implicit let)
    if (next?.type === TokenType.Operator && next.value === "=") {
      const afterEq = this.peekAt(2);
      if (afterEq?.type !== TokenType.Operator || (afterEq.value !== "=" && afterEq.value !== ">")) {
        // `x = v` declares `x` the FIRST time and assigns on every later use.
        // Modelling a re-assignment as a declaration would make every AST
        // consumer (optimizer, type checker, linter) believe the binding is
        // being redeclared — and the optimizer would promote the accumulated
        // variable to const and drop the accumulation.
        if (this.isNameAlreadyBound(tok.value)) {
          return this.parseExpressionStatement();
        }
        return this.parseVariableDeclaration("let");
      }
    }
    // Bare typed declaration: x: Type = value (implicit let)
    if (next?.type === TokenType.Delimiter && next.value === ":") {
      return this.parseVariableDeclaration("let");
    }
    return this.parseExpressionStatement();
  }

  // Names bound so far in the enclosing function scope (or any outer scope).
  // Used to tell a first-use declaration from a re-assignment.
  private isNameAlreadyBound(name: string): boolean {
    return this.boundNames.has(name);
  }

  private declareName(name: string): void {
    this.boundNames.add(name);
  }

  private parseAsync(): Statement {
    this.consumeKeyword("async");
    const tok = this.peek();
    if (tok.type === TokenType.Keyword && tok.value === "fn") {
      const next = this.peekNext();
      return this.parseFunctionDeclaration(true, next?.type === TokenType.Operator && next?.value === "*");
    }
    this.error(tok, "Expected 'fn' after 'async'");
  }

  private parseFunctionDeclaration(isAsync: boolean, isGenerator = false): FunctionDeclaration {
    this.consumeKeyword("fn");
    // Consume * for generators: fn* name()
    if (isGenerator && this.checkOperator("*")) {
      this.advance();
    }
    const name = this.consumeIdentifier("Expected function name");
    this.declareName(name.name);
    // Optional generic type parameters: fn identity<T>(x: T): T
    const typeParams = this.parseTypeParams();
    this.consumeDelimiter("(", "Expected '('");
    const params = this.parseParamList();
    this.consumeDelimiter(")", "Expected ')'");

    // Optional return type: fn add(a, b): number { ... }
    let returnType: TypeAnnotation | undefined;
    if (this.checkDelimiter(":")) {
      this.advance();
      returnType = this.parseTypeAnnotation();
    }

    // expression-style: fn sum(a,b) = a + b
    if (this.checkOperator("=")) {
      this.advance();
      const expr = this.parseExpression();
      const body: Statement[] = [{ type: "ExpressionStatement", expression: expr }];
      return { type: "FunctionDeclaration", name, params, body, async: isAsync, generator: isGenerator, returnType, typeParams };
    }

    const body = this.parseBlock();
    return { type: "FunctionDeclaration", name, params, body, async: isAsync, generator: isGenerator, returnType, typeParams };
  }

  // Anonymous function expression: fn(a, b) { ... } (and fn*(a) { ... }).
  // Reuses the declaration's parameter/type/body grammar, but produces a
  // FunctionExpression — no name to bind, and valid wherever an expression is.
  private parseFunctionExpression(isGenerator = false): Expression {
    this.consumeKeyword("fn");
    if (isGenerator && this.checkOperator("*")) {
      this.advance();
    }
    return this.parseFunctionExpressionTail(isGenerator);
  }

  // The `(params) [: T] (=|{ ... })` tail shared by the anonymous and the
  // named-function-as-a-value forms, so both cannot drift apart.
  private parseFunctionExpressionTail(isGenerator: boolean): Expression {
    this.consumeDelimiter("(", "Expected '('");
    const params = this.parseParamList();
    this.consumeDelimiter(")", "Expected ')'");

    let returnType: TypeAnnotation | undefined;
    if (this.checkDelimiter(":")) {
      this.advance();
      returnType = this.parseTypeAnnotation();
    }

    // expression-style body: fn(a) = a * 2
    if (this.checkOperator("=")) {
      this.advance();
      const expr = this.parseExpression();
      const body: Statement[] = [{ type: "ExpressionStatement", expression: expr }];
      // implicitReturn: the single expression IS the return value. Without this
      // flag the generator emits a bare `a * 2;` and the function returns
      // undefined — the same rule a named `fn f(a) = expr` already follows.
      return {
        type: "FunctionExpression", params, body, async: false,
        generator: isGenerator, returnType, implicitReturn: true,
      } as any;
    }

    const body = this.parseBlock();
    // A block body whose last statement is a bare expression returns it
    // implicitly, matching named `fn f(a) { a * 2 }`.
    const implicitReturn = body.length > 0 && body[body.length - 1].type === "ExpressionStatement";
    return {
      type: "FunctionExpression", params, body, async: false,
      generator: isGenerator, returnType, implicitReturn,
    } as any;
  }

  private parseParamList(): Param[] {
    const params: Param[] = [];
    if (this.checkDelimiter(")")) return params;
    do {
      if (this.checkDelimiter(")")) break; // trailing comma
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
        this.declarePatternNames(pattern);
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
        this.declarePatternNames(pattern);
        continue;
      }
      const tok = this.peek();
      if (!this.isIdentifierLike(tok)) this.error(tok, "Expected parameter name");
      this.advance();
      // Optional type annotation: fn add(a: number, b: number) { ... }
      let typeAnnotation: TypeAnnotation | undefined;
      if (this.checkDelimiter(":")) {
        this.advance();
        typeAnnotation = this.parseTypeAnnotation();
      }
      let defaultValue: Expression | undefined;
      if (this.checkOperator("=")) {
        this.advance();
        defaultValue = this.parseExpression();
      }
      params.push({ type: "Param", name: tok.value, typeAnnotation, defaultValue, rest });
      this.declareName(tok.value);
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
    // The loop variable is bound for the body, so register it before parsing
    // the body: `for v in xs { v = 1 }` is a re-assignment, not a new binding.
    if (variable.type === "Identifier") {
      this.declareName(variable.name);
    }
    // Support both 'for x in expr' and 'for x of expr'
    let kind: "in" | "of" = "in";
    if (this.checkKeyword("of")) {
      kind = "of";
      this.advance();
    } else {
      this.consumeKeyword("in");
    }
    const iterable = this.parseExpression();
    const body = this.parseBlock();
    return { type: "ForStatement", variable, iterable, body, kind };
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
    let namespaceImport: string | null = null;
    const namedImports: ImportSpecifier[] = [];

    if (this.checkDelimiter("{")) {
      this.advance();
      if (!this.checkDelimiter("}")) {
        do {
          const tok = this.peek();
          if (!this.isIdentifierLike(tok)) this.error(tok, "Expected import name");
          const name = tok.value;
          this.advance();
          let alias: string | undefined;
          if (this.checkContextualKeyword("as") || this.checkKeyword("as")) {
            this.advance();
            const aliasTok = this.peek();
            if (!this.isIdentifierLike(aliasTok)) this.error(aliasTok, "Expected alias name");
            alias = aliasTok.value;
            this.advance();
          }
          namedImports.push({ type: "ImportSpecifier", name, alias });
        } while (this.matchDelimiter(","));
      }
      this.consumeDelimiter("}", "Expected '}'");
    } else if (this.checkOperator("*")) {
      // import * as name from "module"
      this.advance(); // *
      // consume 'as' — it's an identifier, not a keyword
      const asTok = this.peek();
      if ((asTok.type === TokenType.Identifier || asTok.type === TokenType.Keyword) && asTok.value === "as") {
        this.advance();
      } else {
        this.error(asTok, "Expected 'as' after '*'");
      }
      const tok = this.peek();
      if (tok.type !== TokenType.Identifier) this.error(tok, "Expected module name");
      namespaceImport = tok.value;
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
    return { type: "ImportDeclaration", defaultImport, namespaceImport, namedImports, source: srcTok.value };
  }

  private parseExportDeclaration(): ExportDeclaration {
    this.consumeKeyword("export");

    // export default ...
    if (this.checkKeyword("default")) {
      this.advance();
      const declaration = this.parseStatement();
      return { type: "ExportDeclaration", declaration, isDefault: true };
    }

    // export * from "mod"  or  export * as ns from "mod"
    if (this.checkOperator("*")) {
      this.advance();
      let exportAllAlias: string | undefined;
      if (this.checkContextualKeyword("as")) {
        this.advance();
        exportAllAlias = this.consumeIdentifier("Expected alias name").name;
      }
      this.consumeKeyword("from");
      const source = this.peek().value;
      this.advance(); // consume string
      return { type: "ExportDeclaration", isDefault: false, exportAll: true, source, exportAllAlias };
    }

    // export { x, y }  or  export { x as y } from "mod"
    if (this.checkDelimiter("{")) {
      this.advance(); // consume {
      const namedExports: ExportSpecifier[] = [];
      while (!this.checkDelimiter("}") && !this.isAtEnd()) {
        const name = this.consumeIdentifier("Expected export name").name;
        let alias: string | undefined;
        if (this.checkContextualKeyword("as")) {
          this.advance();
          alias = this.consumeIdentifier("Expected alias name").name;
        }
        namedExports.push({ type: "ExportSpecifier", name, alias });
        if (!this.matchDelimiter(",")) break;
      }
      this.consumeDelimiter("}", "Expected '}'");

      let source: string | undefined;
      if (this.checkKeyword("from")) {
        this.advance();
        source = this.peek().value;
        this.advance(); // consume string
      }
      return { type: "ExportDeclaration", isDefault: false, namedExports, source };
    }

    // export fn/class/const/let/var ...
    const declaration = this.parseStatement();
    return { type: "ExportDeclaration", declaration, isDefault: false };
  }

  private parseClassDeclaration(): ClassDeclaration {
    this.consumeKeyword("class");
    const name = this.consumeIdentifier("Expected class name");
    // Optional generic type parameters: class Box<T>
    const typeParams = this.parseTypeParams();
    let superClass: Identifier | null = null;

    if (this.checkKeyword("extends")) {
      this.advance();
      superClass = this.consumeIdentifier("Expected superclass name");
    }

    // Optional implements clause: class Foo implements Bar, Baz
    let implementsList: Identifier[] | undefined;
    if (this.checkContextualKeyword("implements")) {
      this.advance();
      implementsList = [];
      do {
        implementsList.push(this.consumeIdentifier("Expected interface name after 'implements'"));
      } while (this.checkDelimiter(",") && this.advance());
    }

    this.consumeDelimiter("{", "Expected '{'");
    const body: (ClassMethod | ClassField)[] = [];

    while (!this.checkDelimiter("}") && !this.isAtEnd()) {
      let isStatic = false;
      let isAsync = false;
      let kind: "method" | "get" | "set" | "constructor" = "method";

      // Check for 'static' modifier
      if (this.checkKeyword("static")) {
        isStatic = true;
        this.advance();
      }

      // Check for 'async'
      if (this.checkKeyword("async")) {
        isAsync = true;
        this.advance();
      }

      // Check for 'get' or 'set' — but only if followed by identifier/computed
      if (this.peek().type === TokenType.Identifier && (this.peek().value === "get" || this.peek().value === "set")) {
        const next = this.peekNext();
        if (next && (next.type === TokenType.Identifier || (next.type === TokenType.Delimiter && next.value === "["))) {
          kind = this.peek().value as "get" | "set";
          this.advance();
        }
      }

      // Skip 'fn' keyword if present, detect fn*
      let isGenerator = false;
      if (this.checkKeyword("fn")) {
        this.advance();
        if (this.checkOperator("*")) {
          isGenerator = true;
          this.advance();
        }
      }

      // Parse member name (identifier or computed [expr])
      let memberName: Identifier | Expression;
      let computed = false;

      if (this.checkDelimiter("[")) {
        computed = true;
        this.advance(); // skip [
        memberName = this.parseExpression();
        this.consumeDelimiter("]", "Expected ']'");
      } else {
        memberName = this.consumeIdentifier("Expected member name");
      }

      // Detect constructor
      if (!computed && (memberName as Identifier).name === "constructor") {
        kind = "constructor";
      }

      // Method: name(...) { ... }
      if (this.checkDelimiter("(")) {
        this.consumeDelimiter("(", "Expected '('");
        const params = this.parseParamList();
        this.consumeDelimiter(")", "Expected ')'");

        // Optional return type
        let returnType: TypeAnnotation | undefined;
        if (this.checkDelimiter(":")) {
          this.advance();
          returnType = this.parseTypeAnnotation();
        }

        const methodBody = this.parseBlock();
        body.push({
          type: "ClassMethod",
          name: memberName,
          params,
          body: methodBody,
          async: isAsync,
          generator: isGenerator,
          static: isStatic,
          kind,
          computed,
          returnType,
        });
      } else {
        // Class field: name = value or just name
        let value: Expression | null = null;
        if (this.checkOperator("=")) {
          this.advance();
          value = this.parseExpression();
        }
        body.push({
          type: "ClassField",
          name: memberName,
          value,
          static: isStatic,
          computed,
        });
      }
    }

    this.consumeDelimiter("}", "Expected '}'");
    return { type: "ClassDeclaration", name, superClass, implements: implementsList, body, typeParams };
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
      this.declarePatternNames(pattern);
      return { type: "DestructuringDeclaration", pattern, value, kind };
    }
    if (this.checkDelimiter("[")) {
      const pattern = this.parseArrayPattern();
      this.consumeOperator("=", "Expected '=' after destructuring pattern");
      const value = this.parseExpression();
      this.declarePatternNames(pattern);
      return { type: "DestructuringDeclaration", pattern, value, kind };
    }
    return this.parseVariableDeclaration(kind);
  }

  // Register every identifier a destructuring pattern binds.
  private declarePatternNames(pattern: ObjectPattern | ArrayPattern): void {
    const walk = (p: any): void => {
      if (!p) return;
      if (p.type === "ObjectPattern") {
        for (const prop of p.properties ?? []) {
          // ObjectPatternProperty binds the *value*; `key` is the source key.
          const bound = prop.value ?? prop.name;
          if (bound && bound.type === "Identifier") this.declareName(bound.name);
          else if (bound) walk(bound);
        }
        if (p.rest) this.declareName(p.rest.name);
      } else if (p.type === "ArrayPattern") {
        for (const el of p.elements ?? []) {
          if (!el) continue;
          if (el.type === "Identifier") this.declareName(el.name);
          else walk(el);
        }
        if (p.rest) this.declareName(p.rest.name);
      } else if (p.type === "Identifier") {
        this.declareName(p.name);
      }
    };
    walk(pattern);
  }

  private parseVariableDeclaration(kind: "let" | "const" | "var"): VariableDeclaration {
    const name = this.consumeIdentifier("Expected variable name");
    // Optional type annotation: let x: number = 42
    let typeAnnotation: TypeAnnotation | undefined;
    if (this.checkDelimiter(":")) {
      this.advance();
      typeAnnotation = this.parseTypeAnnotation();
    }
    this.consumeOperator("=", "Expected '=' in assignment");
    const value = this.parseExpression();
    this.declareName(name.name);
    return { type: "VariableDeclaration", name, value, kind, typeAnnotation };
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

  private parseMatchStatement(): MatchStatement {
    this.consumeKeyword("match");
    const discriminant = this.parseExpression();
    this.consumeDelimiter("{", "Expected '{'");
    const cases: MatchCase[] = [];

    while (!this.checkDelimiter("}") && !this.isAtEnd()) {
      if (this.checkKeyword("case")) {
        this.advance();
        const pattern = this.parseExpression();
        // Optional guard. `when` is the documented spelling; `if` is accepted
        // too because it was the only form the parser used to understand.
        let guard: Expression | undefined;
        if (this.checkContextualKeyword("when") || this.checkKeyword("if")) {
          this.advance();
          guard = this.parseExpression();
        }
        const body = this.parseBlock();
        cases.push({ type: "MatchCase", pattern, guard, body });
      } else if (this.checkKeyword("default")) {
        this.advance();
        // A `default` may also carry a guard: `default when x > 0 { ... }`
        let guard: Expression | undefined;
        if (this.checkContextualKeyword("when") || this.checkKeyword("if")) {
          this.advance();
          guard = this.parseExpression();
        }
        const body = this.parseBlock();
        cases.push({ type: "MatchCase", pattern: null, guard, body });
      } else {
        this.error(this.peek(), "Expected 'case' or 'default' in match");
      }
    }

    this.consumeDelimiter("}", "Expected '}'");
    return { type: "MatchStatement", discriminant, cases };
  }

  private parseEnumDeclaration(): EnumDeclaration {
    this.consumeKeyword("enum");
    const nameTok = this.advance();
    if (nameTok.type !== TokenType.Identifier) {
      this.error(nameTok, "Expected enum name");
    }
    const name: Identifier = { type: "Identifier", name: nameTok.value };
    this.consumeDelimiter("{", "Expected '{' after enum name");
    const members: EnumMember[] = [];

    while (!this.checkDelimiter("}") && !this.isAtEnd()) {
      const memberTok = this.advance();
      if (memberTok.type !== TokenType.Identifier && memberTok.type !== TokenType.Keyword) {
        this.error(memberTok, "Expected enum member name");
      }
      const memberName: Identifier = { type: "Identifier", name: memberTok.value };
      let value: Expression | null = null;

      if (this.checkOperator("=")) {
        this.advance();
        value = this.parseExpression();
      }

      members.push({ type: "EnumMember", name: memberName, value });

      // Optional comma separator
      if (this.checkDelimiter(",")) {
        this.advance();
      }
    }

    this.consumeDelimiter("}", "Expected '}' after enum body");
    return { type: "EnumDeclaration", name, members };
  }

  private parseInterfaceDeclaration(): InterfaceDeclaration {
    this.consumeKeyword("interface");
    const nameTok = this.advance();
    if (nameTok.type !== TokenType.Identifier) {
      this.error(nameTok, "Expected interface name");
    }
    const name: Identifier = { type: "Identifier", name: nameTok.value };

    // Optional: interface Foo extends Bar, Baz { ... }
    let extendsIds: Identifier[] | undefined;
    if (this.checkKeyword("extends")) {
      this.advance();
      extendsIds = [];
      do {
        const extTok = this.advance();
        if (extTok.type !== TokenType.Identifier) {
          this.error(extTok, "Expected interface name after 'extends'");
        }
        extendsIds.push({ type: "Identifier", name: extTok.value });
      } while (this.checkDelimiter(",") && this.advance());
    }

    this.consumeDelimiter("{", "Expected '{' after interface name");
    const properties: InterfaceProperty[] = [];

    while (!this.checkDelimiter("}") && !this.isAtEnd()) {
      const propTok = this.advance();
      if (propTok.type !== TokenType.Identifier) {
        this.error(propTok, "Expected property name in interface");
      }
      const propName: Identifier = { type: "Identifier", name: propTok.value };

      let optional = false;
      if (this.checkOperator("?")) {
        this.advance();
        optional = true;
      }

      // Method signature: name(params): ReturnType
      if (this.checkDelimiter("(")) {
        this.advance(); // consume (
        const params: TypeAnnotation[] = [];
        while (!this.checkDelimiter(")") && !this.isAtEnd()) {
          // param: Type
          this.advance(); // param name (skip)
          if (this.checkDelimiter(":")) {
            this.advance();
            params.push(this.parseTypeAnnotation());
          }
          if (this.checkDelimiter(",")) this.advance();
        }
        this.consumeDelimiter(")", "Expected ')' in method signature");
        let returnType: TypeAnnotation = { kind: "named", name: "void" };
        if (this.checkDelimiter(":")) {
          this.advance();
          returnType = this.parseTypeAnnotation();
        }
        properties.push({
          type: "InterfaceProperty", name: propName, valueType: returnType,
          optional, method: true, params,
        });
      } else {
        // Property: name: Type
        this.consumeDelimiter(":", "Expected ':' after property name");
        const valueType = this.parseTypeAnnotation();
        properties.push({
          type: "InterfaceProperty", name: propName, valueType,
          optional, method: false,
        });
      }

      // Optional comma/semicolon separator
      if (this.checkDelimiter(",") || this.checkDelimiter(";")) {
        this.advance();
      }
    }

    this.consumeDelimiter("}", "Expected '}' after interface body");
    return { type: "InterfaceDeclaration", name, properties, extends: extendsIds };
  }

  private parseTypeOrADT(): TypeAliasDeclaration | ADTDeclaration {
    // Save position to peek ahead after consuming 'type Name<T> ='
    this.consumeContextualKeyword("type");
    const name = this.consumeIdentifier("Expected type alias name");
    const typeParams = this.parseTypeParams();
    this.consumeOperator("=", "Expected '=' after type alias name");

    // Detect ADT: RHS starts with Uppercase Identifier followed by '(' or '|'
    // Examples: type Option = Some(number) | None
    //           type Shape = Circle(number) | Rectangle(number, number) | Point
    const cur = this.peek();
    const next = this.peekNext();
    if (cur.type === TokenType.Identifier && /^[A-Z]/.test(cur.value)) {
      // Could be ADT if followed by '(' (variant with fields) or '|' (next variant)
      // or if next is just another identifier (unit variant followed by |)
      if ((next?.type === TokenType.Delimiter && (next.value === "(" || next.value === "|")) ||
          (next?.type === TokenType.Operator && next.value === "|")) {
        return this.parseADTVariants(name, typeParams);
      }
      // Also detect: single unit variant (no | after) — but this looks like a named type
      // So only parse as ADT when there's clear variant syntax (| or parenthesized fields)
    }

    // Regular type alias
    const value = this.parseTypeAnnotation();
    return { type: "TypeAliasDeclaration", name, typeParams, value };
  }

  private parseADTVariants(name: Identifier, typeParams?: string[]): ADTDeclaration {
    const variants: ADTVariant[] = [];

    // Parse first variant
    variants.push(this.parseOneVariant());

    // Parse remaining variants separated by |
    while ((this.checkOperator("|") || this.checkDelimiter("|")) && !this.isAtEnd()) {
      this.advance(); // consume |
      variants.push(this.parseOneVariant());
    }

    return { type: "ADTDeclaration", name, typeParams, variants };
  }

  private parseOneVariant(): ADTVariant {
    const vName = this.consumeIdentifier("Expected variant name");
    const fields: ADTField[] = [];

    // Optional fields in parentheses: Variant(field1: Type, field2: Type) or Variant(Type)
    if (this.checkDelimiter("(")) {
      this.advance(); // consume (
      if (!this.checkDelimiter(")")) {
        do {
          if (this.checkDelimiter(")")) break; // trailing comma
          let fieldName: Identifier | null = null;
          let typeAnnotation: TypeAnnotation | undefined;

          // Check if this is named field: name: Type
          const cur = this.peek();
          const next = this.peekNext();
          if ((cur.type === TokenType.Identifier || this.isIdentifierLike(cur)) &&
              next && next.type === TokenType.Delimiter && next.value === ":") {
            fieldName = { type: "Identifier", name: cur.value };
            this.advance(); // consume name
            this.advance(); // consume :
            typeAnnotation = this.parseTypeAnnotation();
          } else {
            // Positional field: just a type
            typeAnnotation = this.parseTypeAnnotation();
          }

          fields.push({ type: "ADTField", name: fieldName, typeAnnotation });
        } while (this.matchDelimiter(","));
      }
      this.consumeDelimiter(")", "Expected ')'");
    }

    return { type: "ADTVariant", name: vName, fields };
  }

  private parseGoStatement(): Statement {
    this.consumeKeyword("go");
    // go { ... } — block form
    if (this.checkDelimiter("{")) {
      const body = this.parseBlock();
      return { type: "GoStatement", expression: null, body } as any;
    }
    // go expression — typically a call expression
    const expression = this.parseExpression();
    return { type: "GoStatement", expression, body: null } as any;
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

      // Binary operators
      if (tok.type === TokenType.Operator && PRECEDENCE[tok.value] !== undefined) {
        const opPrec = PRECEDENCE[tok.value];
        if (opPrec <= precedence) break;
        this.advance();
        const right = this.parseExpression(tok.value === "**" ? opPrec - 1 : opPrec); // ** is right-associative
        left = { type: "BinaryExpression", operator: tok.value, left, right } as BinaryExpression;
        continue;
      }

      // instanceof / in as binary operators (keywords)
      if (tok.type === TokenType.Keyword && (tok.value === "instanceof" || tok.value === "in")) {
        const opPrec = PRECEDENCE[tok.value];
        if (opPrec <= precedence) break;
        this.advance();
        const right = this.parseExpression(opPrec);
        left = { type: "BinaryExpression", operator: tok.value, left, right } as BinaryExpression;
        continue;
      }

      // Type assertion: value as Type (stripped in output)
      if ((tok.type === TokenType.Identifier || tok.type === TokenType.Keyword) && tok.value === "as") {
        this.advance(); // consume 'as'
        const typeAnnotation = this.parseTypeAnnotation();
        left = { type: "AsExpression", expression: left, typeAnnotation } as AsExpression;
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
        const prop = this.consumePropertyName("Expected property name");
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
      const newExpr = { type: "NewExpression", callee, arguments: args } as NewExpression;
      return this.parsePostfix(newExpr);
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

    return this.parsePostfix();
  }

  private parsePostfix(initial?: Expression): Expression {
    let left = initial ?? this.parsePrimary();

    while (true) {
      const tok = this.peek();

      // Member access . and ?.
      if (tok.type === TokenType.Operator && (tok.value === "." || tok.value === "?.")) {
        const optional = tok.value === "?.";
        this.advance();
        if (optional && this.checkDelimiter("(")) {
          left = this.parseCallArguments(left, true);
          continue;
        }
        if (optional && this.checkDelimiter("[")) {
          this.advance();
          const prop = this.parseExpression();
          this.consumeDelimiter("]", "Expected ']'");
          left = { type: "MemberExpression", object: left, property: prop, computed: true, optional: true } as MemberExpression;
          continue;
        }
        const prop = this.consumePropertyName("Expected property name");
        left = { type: "MemberExpression", object: left, property: prop, computed: false, optional } as MemberExpression;
        if (this.checkDelimiter("(")) {
          left = this.parseCallArguments(left, false);
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

      // Function call (
      if (tok.type === TokenType.Delimiter && tok.value === "(") {
        if (left.type === "Identifier" || left.type === "MemberExpression" || left.type === "CallExpression") {
          left = this.parseCallArguments(left, false);
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

      // Bare-parameter arrow: `x => body`, where `x` parsed as an identifier.
      if (tok.type === TokenType.Operator && tok.value === "=>" && left.type === "Identifier") {
        this.advance(); // consume '=>'
        left = this.parseArrowBody([{ type: "Param", name: (left as Identifier).name }], false);
        continue;
      }

      break;
    }

    return left;
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

    // If-expression: if condition { ... } else { ... }
    if (token.type === TokenType.Keyword && token.value === "if") {
      this.advance();
      const condition = this.parseExpression();
      const consequent = this.parseBlock();
      this.consumeKeyword("else");
      const alternate = this.parseBlock();
      return { type: "IfExpression", condition, consequent, alternate } as IfExpression;
    }

    // Dynamic import: import("./module")
    if (token.type === TokenType.Keyword && token.value === "import" && this.peekNext()?.type === TokenType.Delimiter && this.peekNext()?.value === "(") {
      this.advance(); // consume 'import'
      return this.parseCallArguments({ type: "Identifier", name: "import" } as Identifier, false);
    }

    // Anonymous function expression: fn(a, b) { ... }
    // `fn` is a statement keyword too, so it is only an expression when it is
    // immediately followed by a parameter list — `fn(x) { ... }`. This is what
    // makes the idiomatic `items.filter(fn(f) { return f.ok })` work, which is
    // otherwise indistinguishable from a function *declaration*.
    if (token.type === TokenType.Keyword && token.value === "fn") {
      const next = this.peekNext();
      const isGenerator = next?.type === TokenType.Operator && next?.value === "*";
      const afterStar = isGenerator ? this.peekAt(2) : next;
      if (afterStar?.type === TokenType.Delimiter && afterStar?.value === "(") {
        return this.parseFunctionExpression(isGenerator);
      }
      // A NAMED function used as a value: `return fn testRequire(src) { ... }`.
      // The name is only in scope inside the body, so it is dropped — this is
      // the shape used for closures that need a stack trace name in source.
      const afterName = isGenerator ? this.peekAt(3) : this.peekAt(2);
      if (afterName?.type === TokenType.Delimiter && afterName?.value === "(") {
        this.advance(); // fn
        if (isGenerator) this.advance(); // *
        this.advance(); // name
        return this.parseFunctionExpressionTail(isGenerator);
      }
    }

    // Comptime expression: comptime { ... } or comptime expr
    if (token.type === TokenType.Identifier && token.value === "comptime") {
      this.advance(); // consume 'comptime'
      if (this.checkDelimiter("{")) {
        const body = this.parseBlock();
        return { type: "ComptimeExpression", expression: null, body } as any;
      }
      // Parse the full expression so binary ops like 2 ** 10 are captured
      const expression = this.parseExpression();
      return { type: "ComptimeExpression", expression, body: null } as any;
    }

    // Identifier or contextual keyword used as identifier (print, type, as, etc.)
    if (this.isIdentifierLike(token)) {
      this.advance();
      return { type: "Identifier", name: token.value } as Identifier;
    }

    // Number literal
    if (token.type === TokenType.Number) {
      this.advance();
      return numberLiteral(token) as Literal;
    }

    // Raw string literal (single-quoted, no interpolation)
    if (token.type === TokenType.RawString) {
      this.advance();
      return { type: "Literal", value: token.value, literalType: "string" } as Literal;
    }

    // String literal (double-quoted, with interpolation detection)
    if (token.type === TokenType.String) {
      this.advance();
      return this.parseStringLiteral(token.value, token.loc);
    }

    // Template literal from lexer (backtick strings)
    if (token.type === TokenType.TemplateLiteral) {
      this.advance();
      return this.parseTemplateLiteral(token.value, token.loc);
    }

    // Regex literal
    if (token.type === TokenType.RegExp) {
      this.advance();
      // Parse /pattern/flags into parts
      const regexStr = token.value;
      const lastSlash = regexStr.lastIndexOf("/");
      const pattern = regexStr.slice(1, lastSlash);
      const flags = regexStr.slice(lastSlash + 1);
      return { type: "RegExpLiteral", pattern, flags } as RegExpLiteral;
    }

    this.error(token, "Expected expression");
  }

  private parseCallArguments(callee: Expression, optional = false): CallExpression {
    this.consumeDelimiter("(", "Expected '('");
    const args: Expression[] = [];
    const namedArgs: NamedArgument[] = [];
    if (!this.checkDelimiter(")")) {
      do {
        if (this.checkDelimiter(")")) break; // trailing comma
        // Check for named argument: identifier followed by ':'
        if (this.isNamedArgument()) {
          const name = this.consumeIdentifier("Expected argument name");
          this.consumeDelimiter(":", "Expected ':'");
          const value = this.parseExpression();
          namedArgs.push({ type: "NamedArgument", name, value });
        } else {
          args.push(this.parseExpression());
        }
      } while (this.matchDelimiter(","));
    }
    this.consumeDelimiter(")", "Expected ')'");
    const call: CallExpression = { type: "CallExpression", callee, arguments: args, optional };
    if (namedArgs.length > 0) call.namedArgs = namedArgs;
    return call;
  }

  private isNamedArgument(): boolean {
    const cur = this.peek();
    const next = this.peekNext();
    // Named arg: Identifier (or contextual keyword used as identifier) followed by ':'
    // But NOT followed by ':' then another ':' (which would be :: or similar)
    if ((cur.type === TokenType.Identifier || this.isIdentifierLike(cur)) &&
        next && next.type === TokenType.Delimiter && next.value === ":") {
      // Make sure it's not a ternary's ':' — look ahead past the ':' to see if this makes sense
      // In practice, 'name: value' in a call arg list is always a named argument
      return true;
    }
    return false;
  }

  private parseArrayExpression(): ArrayExpression {
    this.consumeDelimiter("[", "Expected '['");
    const elements: Expression[] = [];
    if (!this.checkDelimiter("]")) {
      do {
        if (this.checkDelimiter("]")) break; // trailing comma
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
        if (this.checkDelimiter("}")) break; // trailing comma

        // Object spread: { ...src, key: value }
        // This is a property whose key is a spread marker, not a real key.
        if (this.checkOperator("...")) {
          this.advance();
          const spreadValue = this.parseExpression();
          properties.push({
            type: "ObjectProperty",
            key: { type: "Identifier", name: "..." },
            value: spreadValue,
            shorthand: false,
            computed: false,
            spread: true,
          } as any);
          continue;
        }

        const keyTok = this.peek();
        let key: Identifier | Literal | Expression;
        let computed = false;

        // Computed property name: { [expr]: value }
        if (keyTok.type === TokenType.Delimiter && keyTok.value === "[") {
          computed = true;
          this.advance(); // skip [
          key = this.parseExpression();
          this.consumeDelimiter("]", "Expected ']'");
        } else if (keyTok.type === TokenType.Identifier || (keyTok.type === TokenType.Keyword)) {
          key = { type: "Identifier", name: keyTok.value };
          this.advance();
        } else if (keyTok.type === TokenType.String || keyTok.type === TokenType.RawString) {
          key = { type: "Literal", value: keyTok.value, literalType: "string" };
          this.advance();
        } else if (keyTok.type === TokenType.Number) {
          key = numberLiteral(keyTok) as Literal;
          this.advance();
        } else {
          this.error(keyTok, "Expected property key");
        }

        // Shorthand: { name } → { name: name }
        if (!computed && !this.checkDelimiter(":")) {
          properties.push({
            type: "ObjectProperty",
            key,
            value: { type: "Identifier", name: (key as Identifier).name },
            shorthand: true,
            computed: false,
          });
        } else {
          if (this.checkDelimiter(":")) this.advance();
          const value = this.parseExpression();
          properties.push({ type: "ObjectProperty", key, value, shorthand: false, computed });
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

    // `(x) => ({ ...x, k: v })` — object literal wrapped in parentheses.
    if (this.checkDelimiter("(")) {
      const inner = this.peekAt(1);
      if (inner && inner.type === TokenType.Delimiter && inner.value === "{") {
        this.advance(); // (
        const obj = this.parseObjectExpression();
        this.consumeDelimiter(")", "Expected ')'");
        return { type: "ArrowFunction", params, body: obj, async: isAsync };
      }
    }

    return this.parseArrowBody(params, isAsync);
  }

  private parseArrowBody(params: Param[], isAsync: boolean): ArrowFunction {
    if (this.checkDelimiter("{")) {
      // `(x) => { ...x, k: v }` is an object literal, not a block body.
      // A block body starts with a statement (a keyword, an identifier being
      // assigned, a call, ...) — a spread or a `key:` can only be an object.
      if (this.arrowBodyIsObjectLiteral()) {
        const obj = this.parseObjectExpression();
        return { type: "ArrowFunction", params, body: obj, async: isAsync };
      }
      const body = this.parseBlock();
      return { type: "ArrowFunction", params, body, async: isAsync };
    }

    const expr = this.parseExpression();
    return { type: "ArrowFunction", params, body: expr, async: isAsync };
  }

  // After `=>` and an opening `{`, decide block-body vs object-literal by
  // looking at what follows. Conservative: only claim "object" for shapes
  // that cannot start a statement.
  private arrowBodyIsObjectLiteral(): boolean {
    const next = this.peekAt(1);
    if (!next) return false;
    // { ...spread }  /  { ...spread, k: v }
    if (next.type === TokenType.Operator && next.value === "...") return true;
    // { "str": v }  /  { 123: v }  /  { [computed]: v }
    if (next.type === TokenType.String || next.type === TokenType.RawString || next.type === TokenType.Number) return true;
    if (next.type === TokenType.Delimiter && next.value === "[") return true;
    // { ident: v } — but `{ ident }` and `{ ident(...) }` are blocks, so only
    // treat it as an object when an explicit `:` follows the identifier.
    if (next.type === TokenType.Identifier) {
      const after = this.peekAt(2);
      return !!after && after.type === TokenType.Delimiter && after.value === ":";
    }
    return false;
  }

  // Nodeon-style string interpolation: "Hello {name}" → template literal
  private parseStringLiteral(raw: string, loc?: { line: number; column: number }): Literal | TemplateLiteral {
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
        // Only treat { as interpolation if followed by identifier-start char
        // This allows literal braces in strings like "{ }" or "{;"
        const nextCh = i + 1 < raw.length ? raw[i + 1] : "";
        const isInterpolation = /[a-zA-Z_$!~([]/.test(nextCh);
        if (!isInterpolation) {
          buffer += raw[i];
          i++;
          continue;
        }
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
          const where = loc ? ` at ${loc.line}:${loc.column + i}` : "";
          throw new SyntaxError(`Unterminated interpolation in string literal${where}`);
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
  private parseTemplateLiteral(raw: string, loc?: { line: number; column: number }): TemplateLiteral {
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
        if (braceDepth !== 0) {
          const where = loc ? ` at ${loc.line}:${loc.column + i}` : "";
          throw new SyntaxError(`Unterminated interpolation in template literal${where}`);
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

  // ── Generic Type Parameters ─────────────────────────────────────

  private parseTypeParams(): string[] | undefined {
    // Check for < — but only if it's actually a type param list, not a comparison
    if (!this.checkOperator("<")) return undefined;

    // Peek ahead: <Identifier, ...> means type params
    const next = this.peekNext();
    if (!next || next.type !== TokenType.Identifier) return undefined;

    this.advance(); // consume <
    const params: string[] = [];

    do {
      const param = this.consumeIdentifier("Expected type parameter name");
      params.push(param.name);
    } while (this.checkDelimiter(",") && (this.advance(), true));

    if (this.checkOperator(">")) {
      this.advance(); // consume >
    }

    return params.length > 0 ? params : undefined;
  }

  // ── Type Annotation Parsing ──────────────────────────────────────

  private parseTypeAnnotation(): TypeAnnotation {
    let type = this.parseTypePrimary();

    // Array type: number[]
    while (this.checkDelimiter("[")) {
      const next = this.peekNext();
      if (next && next.type === TokenType.Delimiter && next.value === "]") {
        this.advance(); // [
        this.advance(); // ]
        type = { kind: "array", elementType: type };
      } else {
        break;
      }
    }

    // Nullable type: string?, number[]?
    if (this.checkExactOperator("?")) {
      this.advance();
      type = { kind: "nullable", inner: type };
    }

    // Union type: string | number (exact token match, not prefix)
    if (this.checkExactOperator("|")) {
      const types: TypeAnnotation[] = [type];
      while (this.checkExactOperator("|")) {
        this.advance();
        let next = this.parseTypePrimary();
        while (this.checkDelimiter("[")) {
          const n2 = this.peekNext();
          if (n2 && n2.type === TokenType.Delimiter && n2.value === "]") {
            this.advance();
            this.advance();
            next = { kind: "array", elementType: next };
          } else {
            break;
          }
        }
        types.push(next);
      }
      type = { kind: "union", types };
    }

    // Intersection type: A & B (exact token match, not prefix)
    if (this.checkExactOperator("&")) {
      const types: TypeAnnotation[] = [type];
      while (this.checkExactOperator("&")) {
        this.advance();
        let next = this.parseTypePrimary();
        while (this.checkDelimiter("[")) {
          const n2 = this.peekNext();
          if (n2 && n2.type === TokenType.Delimiter && n2.value === "]") {
            this.advance();
            this.advance();
            next = { kind: "array", elementType: next };
          } else {
            break;
          }
        }
        types.push(next);
      }
      type = { kind: "intersection", types };
    }

    return type;
  }

  // One member of an object type literal: `name: T`, `name?: T`, or a
  // shorthand nested type. The key and the value are separate tokens, so this
  // cannot be parsed as a plain type annotation.
  private parseTypeProperty(): TypeAnnotation {
    const tok = this.peek();
    let name: string;
    if (this.isIdentifierLike(tok) || (tok.type === TokenType.String && tok.value)) {
      name = String(tok.value);
      this.advance();
    } else {
      // Computed or otherwise unusual key: parse it as an index signature.
      return this.parseTypeAnnotation();
    }

    let optional = false;
    if (this.checkExactOperator("?")) {
      this.advance();
      optional = true;
    }

    if (!this.checkDelimiter(":")) {
      // Shorthand member such as nested `Foo` or a method signature omitted
      // for now; treat it as a named type reference.
      return { kind: "property", name, optional, type: { kind: "named", name } } as any;
    }

    this.advance(); // consume ':'
    const value = this.parseTypeAnnotation();
    return { kind: "property", name, optional, type: value } as any;
  }

  private parseTypePrimary(): TypeAnnotation {
    const tok = this.peek();

    // Parenthesized type or function type: (number, string) => boolean
    if (tok.type === TokenType.Delimiter && tok.value === "(") {
      this.advance();
      const params: TypeAnnotation[] = [];
      if (!this.checkDelimiter(")")) {
        do {
          params.push(this.parseTypeAnnotation());
        } while (this.matchDelimiter(","));
      }
      this.consumeDelimiter(")", "Expected ')' in function type");
      this.consumeOperator("=>", "Expected '=>' in function type");
      const returnType = this.parseTypeAnnotation();
      return { kind: "function", params, returnType };
    }

    // Named type: number, string, Promise, etc.
    if (tok.type === TokenType.Identifier || (tok.type === TokenType.Keyword && ["void", "null", "undefined"].includes(tok.value))) {
      const name = tok.value;
      this.advance();

      // Generic type: Promise<string>, Map<string, number>
      if (this.checkOperator("<")) {
        this.advance();
        const args: TypeAnnotation[] = [];
        if (!this.checkOperator(">")) {
          do {
            args.push(this.parseTypeAnnotation());
          } while (this.matchDelimiter(","));
        }
        this.consumeOperator(">", "Expected '>' after generic type arguments");
        return { kind: "generic", name, args };
      }

      return { kind: "named", name };
    }

    // Object type literal: { a: number, b?: string }
    // Tuple type: [string, number]
    // Neither was parseable before, so `type P = { a: number }` and
    // `type Pair<A,B> = [A, B]` were hard syntax errors — and a type alias is
    // the most idiomatic way to name a shape, so the whole idiom was missing.
    if (tok.type === TokenType.Delimiter && tok.value === "{") {
      this.advance();
      const properties: TypeAnnotation[] = [];
      while (!this.checkDelimiter("}") && !this.isAtEnd()) {
        properties.push(this.parseTypeProperty());
        if (!this.matchDelimiter(",")) break;
      }
      this.consumeDelimiter("}", "Expected '}' in object type");
      return { kind: "object", properties } as any;
    }

    if (tok.type === TokenType.Delimiter && tok.value === "[") {
      this.advance();
      const elements: TypeAnnotation[] = [];
      while (!this.checkDelimiter("]") && !this.isAtEnd()) {
        elements.push(this.parseTypeAnnotation());
        if (!this.matchDelimiter(",")) break;
      }
      this.consumeDelimiter("]", "Expected ']' in tuple type");
      return { kind: "tuple", elements } as any;
    }

    this.error(tok, "Expected type annotation");
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

}
