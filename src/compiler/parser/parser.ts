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
  LabeledStatement,
  AsExpression,
} from "@ast/nodes";

// PRECEDENCE and COMPOUND_ASSIGN imported from @language/precedence

export class Parser extends ParserBase {
  constructor(tokens: Token[]) {
    super(tokens);
  }

  public errors: SyntaxError[] = [];

  parseProgram(): Program {
    const body: Statement[] = [];
    while (!this.isAtEnd()) {
      try {
        body.push(this.parseStatement());
      } catch (err: any) {
        if (err instanceof SyntaxError) {
          this.errors.push(err);
          // Skip to next statement boundary for recovery
          this.recover();
        } else {
          throw err;
        }
      }
    }
    return { type: "Program", body };
  }

  private recover(): void {
    while (!this.isAtEnd()) {
      const tok = this.peek();
      // Skip to a boundary: newline, semicolon, }, or a keyword that starts a statement
      if (tok.type === TokenType.Delimiter && (tok.value === "}" || tok.value === ";")) {
        this.advance();
        return;
      }
      if (tok.type === TokenType.Keyword && [
        "fn", "if", "for", "while", "do", "return", "import", "export",
        "class", "try", "throw", "const", "let", "var", "switch", "match",
        "enum", "interface", "type", "break", "continue"
      ].includes(tok.value)) {
        return; // Don't consume — let the parser try parsing this as a new statement
      }
      this.advance();
    }
  }

  // ── Statement Parsing ──────────────────────────────────────────────

  private parseStatement(): Statement {
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
        case "type": stmt = this.parseTypeAliasDeclaration(); break;
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
        default: stmt = this.parseExpressionStatement(); break;
      }
    } else if (tok.type === TokenType.Identifier) {
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

    if (loc) stmt.loc = loc;
    return stmt;
  }

  private parseIdentifierStatement(tok: Token, next: Token | undefined): Statement {
    // Bare assignment: x = value (implicit let)
    if (next?.type === TokenType.Operator && next.value === "=") {
      const afterEq = this.peekAt(2);
      if (afterEq?.type !== TokenType.Operator || (afterEq.value !== "=" && afterEq.value !== ">")) {
        return this.parseVariableDeclaration("let");
      }
    }
    // Bare typed declaration: x: Type = value (implicit let)
    if (next?.type === TokenType.Delimiter && next.value === ":") {
      return this.parseVariableDeclaration("let");
    }
    return this.parseExpressionStatement();
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
    const namedImports: ImportSpecifier[] = [];

    if (this.checkDelimiter("{")) {
      this.advance();
      if (!this.checkDelimiter("}")) {
        do {
          const tok = this.peek();
          if (tok.type !== TokenType.Identifier) this.error(tok, "Expected import name");
          const name = tok.value;
          this.advance();
          let alias: string | undefined;
          if (this.checkKeyword("as")) {
            this.advance();
            const aliasTok = this.peek();
            if (aliasTok.type !== TokenType.Identifier) this.error(aliasTok, "Expected alias name");
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
      if (this.checkKeyword("as")) {
        this.advance();
        exportAllAlias = this.consumeIdentifier("Expected alias name").name;
      }
      this.consumeKeyword("from");
      const source = this.peek().value;
      this.advance(); // consume string
      return { type: "ExportDeclaration", isDefault: false, exportAll: true, source, exportAllAlias };
    }

    // export { x, y }  or  export { x } from "mod"
    if (this.checkDelimiter("{")) {
      this.advance(); // consume {
      const namedExports: string[] = [];
      while (!this.checkDelimiter("}") && !this.isAtEnd()) {
        namedExports.push(this.consumeIdentifier("Expected export name").name);
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
    return { type: "ClassDeclaration", name, superClass, body, typeParams };
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
    // Optional type annotation: let x: number = 42
    let typeAnnotation: TypeAnnotation | undefined;
    if (this.checkDelimiter(":")) {
      this.advance();
      typeAnnotation = this.parseTypeAnnotation();
    }
    this.consumeOperator("=", "Expected '=' in assignment");
    const value = this.parseExpression();
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
        // Optional guard: case x if x > 0 { ... }
        let guard: Expression | undefined;
        if (this.checkKeyword("if")) {
          this.advance();
          guard = this.parseExpression();
        }
        const body = this.parseBlock();
        cases.push({ type: "MatchCase", pattern, guard, body });
      } else if (this.checkKeyword("default")) {
        this.advance();
        const body = this.parseBlock();
        cases.push({ type: "MatchCase", pattern: null, body });
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

  private parseTypeAliasDeclaration(): TypeAliasDeclaration {
    this.consumeKeyword("type");
    const name = this.consumeIdentifier("Expected type alias name");
    const typeParams = this.parseTypeParams();
    this.consumeOperator("=", "Expected '=' after type alias name");
    const value = this.parseTypeAnnotation();
    return { type: "TypeAliasDeclaration", name, typeParams, value };
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
      if (tok.type === TokenType.Keyword && tok.value === "as") {
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

      // Member access . and ?. (property, call, index)
      if (tok.type === TokenType.Operator && (tok.value === "." || tok.value === "?.")) {
        const optional = tok.value === "?.";
        this.advance();

        // Optional call: obj?.(args)
        if (optional && this.checkDelimiter("(")) {
          left = this.parseCallArguments(left, true);
          continue;
        }

        // Optional index: obj?.[expr]
        if (optional && this.checkDelimiter("[")) {
          this.advance(); // skip [
          const prop = this.parseExpression();
          this.consumeDelimiter("]", "Expected ']'");
          left = { type: "MemberExpression", object: left, property: prop, computed: true, optional: true } as MemberExpression;
          continue;
        }

        const prop = this.consumeIdentifier("Expected property name");
        left = { type: "MemberExpression", object: left, property: prop, computed: false, optional } as MemberExpression;
        // Check for call: obj.method(...)
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

      // Function call: name(...)
      if (tok.type === TokenType.Delimiter && tok.value === "(") {
        if (left.type === "Identifier" || left.type === "MemberExpression" || left.type === "CallExpression") {
          left = this.parseCallArguments(left, false);
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

    // Dynamic import: import("./module")
    if (token.type === TokenType.Keyword && token.value === "import" && this.peekNext()?.type === TokenType.Delimiter && this.peekNext()?.value === "(") {
      this.advance(); // consume 'import'
      return this.parseCallArguments({ type: "Identifier", name: "import" } as Identifier, false);
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
    if (!this.checkDelimiter(")")) {
      do {
        args.push(this.parseExpression());
      } while (this.matchDelimiter(","));
    }
    this.consumeDelimiter(")", "Expected ')'");
    return { type: "CallExpression", callee, arguments: args, optional };
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
          key = { type: "Literal", value: Number(keyTok.value), literalType: "number" };
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

    if (this.checkDelimiter("{")) {
      const body = this.parseBlock();
      return { type: "ArrowFunction", params, body, async: isAsync };
    }

    const expr = this.parseExpression();
    return { type: "ArrowFunction", params, body: expr, async: isAsync };
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

    // Union type: string | number (only if | is not ||)
    if (this.checkOperator("|") && !this.checkOperator("||")) {
      const types: TypeAnnotation[] = [type];
      while (this.checkOperator("|") && !this.checkOperator("||")) {
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

    // Intersection type: A & B (only if & is not &&)
    if (this.checkOperator("&") && !this.checkOperator("&&")) {
      const types: TypeAnnotation[] = [type];
      while (this.checkOperator("&") && !this.checkOperator("&&")) {
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
