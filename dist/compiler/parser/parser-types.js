import { ParserBase } from "./parser-base.js";
export class ParserTypes extends ParserBase {
  constructor(tokens, source) {
    super(tokens, source);
  }

  parseTypeParams() {
    if (!this.checkOperator("<")) {
      return undefined;
    }
    const next = this.peekNext();
    if (!next || next.type !== "Identifier") {
      return undefined;
    }
    this.advance();
    const params = [];
    do {
      const param = this.consumeIdentifier("Expected type parameter name");
      params.push(param.name);
    } while (this.matchDelimiter(","));
    if (this.checkOperator(">")) {
      this.advance();
    }
    return params.length > 0 ? params : undefined;
  }

  parseTypeAnnotation() {
    let type = this.parseTypePrimary();
    while (this.checkDelimiter("[")) {
      const next = this.peekNext();
      if (next && next.type === "Delimiter" && next.value === "]") {
        this.advance();
        this.advance();
        type = { kind: "array", elementType: type };
      } else {
        break;
      }
    }
    if (this.checkOperator("|") && !this.checkOperator("||")) {
      const types = [type];
      while (this.checkOperator("|") && !this.checkOperator("||")) {
        this.advance();
        let next = this.parseTypePrimary();
        while (this.checkDelimiter("[")) {
          const n2 = this.peekNext();
          if (n2 && n2.type === "Delimiter" && n2.value === "]") {
            this.advance();
            this.advance();
            next = { kind: "array", elementType: next };
          } else {
            break;
          }
        }
        types.push(next);
      }
      type = { kind: "union", types: types };
    }
    if (this.checkOperator("&") && !this.checkOperator("&&")) {
      const types = [type];
      while (this.checkOperator("&") && !this.checkOperator("&&")) {
        this.advance();
        let next = this.parseTypePrimary();
        while (this.checkDelimiter("[")) {
          const n2 = this.peekNext();
          if (n2 && n2.type === "Delimiter" && n2.value === "]") {
            this.advance();
            this.advance();
            next = { kind: "array", elementType: next };
          } else {
            break;
          }
        }
        types.push(next);
      }
      type = { kind: "intersection", types: types };
    }
    return type;
  }

  parseTypePrimary() {
    const tok = this.peek();
    if (tok.type === "Delimiter" && tok.value === "(") {
      this.advance();
      const params = [];
      if (!this.checkDelimiter(")")) {
        do {
          params.push(this.parseTypeAnnotation());
        } while (this.matchDelimiter(","));
      }
      this.consumeDelimiter(")", "Expected ')' in function type");
      this.consumeOperator("=>", "Expected '=>' in function type");
      const returnType = this.parseTypeAnnotation();
      return { kind: "function", params: params, returnType: returnType };
    }
    if (tok.type === "Identifier" || tok.type === "Keyword" && ["void", "null", "undefined"].includes(tok.value)) {
      const name = tok.value;
      this.advance();
      if (this.checkOperator("<")) {
        this.advance();
        const args = [];
        if (!this.checkOperator(">")) {
          do {
            args.push(this.parseTypeAnnotation());
          } while (this.matchDelimiter(","));
        }
        this.consumeOperator(">", "Expected '>' after generic type arguments");
        return { kind: "generic", name: name, args: args };
      }
      return { kind: "named", name: name };
    }
    this.error(tok, "Expected type annotation");
  }

  parseObjectPattern() {
    this.consumeDelimiter("{", `Expected '{'`);
    const properties = [];
    let rest = undefined;
    while (!this.checkDelimiter("}") && !this.isAtEnd()) {
      if (this.checkOperator("...")) {
        this.advance();
        rest = this.consumeIdentifier("Expected rest identifier");
        break;
      }
      const key = this.consumeIdentifier("Expected property name");
      let value = key;
      let shorthand = true;
      let defaultValue = undefined;
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
      if (this.checkOperator("=")) {
        this.advance();
        defaultValue = this.parseExpression();
      }
      properties.push({ type: "ObjectPatternProperty", key: key, value: value, shorthand: shorthand, defaultValue: defaultValue });
      if (!this.matchDelimiter(",")) {
        break;
      }
    }
    this.consumeDelimiter("}", "Expected '}'");
    return { type: "ObjectPattern", properties: properties, rest: rest };
  }

  parseArrayPattern() {
    this.consumeDelimiter("[", "Expected '['");
    const elements = [];
    let rest = undefined;
    while (!this.checkDelimiter("]") && !this.isAtEnd()) {
      if (this.checkOperator("...")) {
        this.advance();
        rest = this.consumeIdentifier("Expected rest identifier");
        break;
      }
      if (this.checkDelimiter(",")) {
        elements.push(null);
        this.advance();
        continue;
      }
      if (this.checkDelimiter("{")) {
        elements.push(this.parseObjectPattern());
      } else if (this.checkDelimiter("[")) {
        elements.push(this.parseArrayPattern());
      } else {
        elements.push(this.consumeIdentifier("Expected element name"));
      }
      if (!this.matchDelimiter(",")) {
        break;
      }
    }
    this.consumeDelimiter("]", "Expected ']'");
    return { type: "ArrayPattern", elements: elements, rest: rest };
  }
}