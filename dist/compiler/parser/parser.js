import { ParserStatements } from "./parser-statements.js";
export class Parser extends ParserStatements {
  constructor(tokens, source) {
    super(tokens, source);
    this.errors = [];
  }

  parseProgram() {
    const body = [];
    while (!this.isAtEnd()) {
      try {
        body.push(this.parseStatement());
      } catch (err) {
        if (err instanceof SyntaxError) {
          this.errors.push(err);
          this.recover();
        } else {
          throw err;
        }
      }
    }
    return { type: "Program", body: body, errors: this.errors };
  }

  recover() {
    let braceDepth = 0;
    while (!this.isAtEnd()) {
      const tok = this.peek();
      if (tok.type === "Delimiter" && tok.value === "{") {
        braceDepth = braceDepth + 1;
        this.advance();
        continue;
      }
      if (tok.type === "Delimiter" && tok.value === "}") {
        if (braceDepth > 0) {
          braceDepth = braceDepth - 1;
          this.advance();
          continue;
        }
        this.advance();
        return;
      }
      if (tok.type === "Delimiter" && tok.value === ";" && braceDepth === 0) {
        this.advance();
        return;
      }
      if (braceDepth === 0 && tok.type === "Keyword" && ["fn", "if", "for", "while", "do", "return", "import", "export", "class", "try", "throw", "const", "let", "var", "switch", "match", "enum", "interface", "break", "continue"].includes(tok.value)) {
        return;
      }
      this.advance();
    }
  }

  parseDecorators() {
    const decorators = [];
    while (this.peek().type === "Decorator") {
      const tok = this.advance();
      const name = tok.value.slice(1);
      let args = undefined;
      if (this.checkDelimiter("(")) {
        this.advance();
        args = [];
        if (!this.checkDelimiter(")")) {
          do {
            args.push(this.parseExpression());
          } while (this.matchDelimiter(","));
        }
        this.consumeDelimiter(")", "Expected ')' after decorator arguments");
      }
      decorators.push({ type: "Decorator", name: name, arguments: args });
    }
    return decorators;
  }

  parseStatement() {
    const decorators = this.parseDecorators();
    const tok = this.peek();
    const loc = tok.loc ? { line: tok.loc.line, column: tok.loc.column } : undefined;
    let stmt = null;
    if (tok.type === "Keyword") {
      switch (tok.value) {
        case "fn": {
          const next = this.peekNext();
          stmt = this.parseFunctionDeclaration(false, next?.type === "Operator" && next?.value === "*");
          break;
        }
        case "async": {
          stmt = this.parseAsync();
          break;
        }
        case "if": {
          stmt = this.parseIfStatement();
          break;
        }
        case "for": {
          stmt = this.parseForStatement();
          break;
        }
        case "while": {
          stmt = this.parseWhileStatement();
          break;
        }
        case "do": {
          stmt = this.parseDoWhileStatement();
          break;
        }
        case "return": {
          stmt = this.parseReturnStatement();
          break;
        }
        case "import": {
          stmt = this.parseImportDeclaration();
          break;
        }
        case "export": {
          stmt = this.parseExportDeclaration();
          break;
        }
        case "class": {
          stmt = this.parseClassDeclaration();
          break;
        }
        case "try": {
          stmt = this.parseTryCatch();
          break;
        }
        case "throw": {
          stmt = this.parseThrowStatement();
          break;
        }
        case "const": {
          stmt = this.parseConstDeclaration();
          break;
        }
        case "let": {
          stmt = this.parseLetDeclaration();
          break;
        }
        case "var": {
          stmt = this.parseVarDeclaration();
          break;
        }
        case "switch": {
          stmt = this.parseSwitchStatement();
          break;
        }
        case "match": {
          stmt = this.parseMatchStatement();
          break;
        }
        case "enum": {
          stmt = this.parseEnumDeclaration();
          break;
        }
        case "interface": {
          stmt = this.parseInterfaceDeclaration();
          break;
        }
        case "break": {
          this.advance();
          let breakLabel = undefined;
          if (this.peek().type === "Identifier") {
            breakLabel = this.peek().value;
            this.advance();
          }
          stmt = { type: "BreakStatement", label: breakLabel };
          break;
        }
        case "continue": {
          this.advance();
          let contLabel = undefined;
          if (this.peek().type === "Identifier") {
            contLabel = this.peek().value;
            this.advance();
          }
          stmt = { type: "ContinueStatement", label: contLabel };
          break;
        }
        case "debugger": {
          this.advance();
          stmt = { type: "DebuggerStatement" };
          break;
        }
        case "go": {
          stmt = this.parseGoStatement();
          break;
        }
        default: {
          stmt = this.parseExpressionStatement();
          break;
        }
      }
    } else if (tok.type === "Identifier") {
      if (tok.value === "type" && this.peekNext()?.type === "Identifier") {
        stmt = this.parseTypeOrADT();
        if (loc) {
          stmt.loc = loc;
        }
        return stmt;
      }
      const next = this.peekNext();
      if (next?.type === "Delimiter" && next.value === ":") {
        const after = this.peekAt(2);
        if (after?.type === "Keyword" && (after.value === "for" || after.value === "while" || after.value === "do")) {
          const label = tok.value;
          this.advance();
          this.advance();
          const body = this.parseStatement();
          stmt = { type: "LabeledStatement", label: label, body: body };
        } else {
          stmt = this.parseIdentifierStatement(tok, next);
        }
      } else {
        stmt = this.parseIdentifierStatement(tok, next);
      }
    } else {
      stmt = this.parseExpressionStatement();
    }
    if (decorators.length > 0) {
      if (stmt.type === "FunctionDeclaration") {
        stmt.decorators = decorators;
      }
      if (stmt.type === "ClassDeclaration") {
        stmt.decorators = decorators;
      }
      if (stmt.type === "ExportDeclaration" && stmt.declaration) {
        if (stmt.declaration.type === "FunctionDeclaration") {
          stmt.declaration.decorators = decorators;
        }
        if (stmt.declaration.type === "ClassDeclaration") {
          stmt.declaration.decorators = decorators;
        }
      }
    }
    if (loc) {
      stmt.loc = loc;
    }
    return stmt;
  }

  parseIdentifierStatement(tok, next) {
    if (next?.type === "Operator" && next.value === "=") {
      const afterEq = this.peekAt(2);
      if (afterEq?.type !== "Operator" || afterEq.value !== "=" && afterEq.value !== ">") {
        return this.parseVariableDeclaration("let");
      }
    }
    if (next?.type === "Delimiter" && next.value === ":") {
      return this.parseVariableDeclaration("let");
    }
    return this.parseExpressionStatement();
  }
}