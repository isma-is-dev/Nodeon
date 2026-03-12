const fs = require("fs");
const path = require("path");

const goFile = path.join(__dirname, "gofile.go");
const goCode = fs.readFileSync(goFile, "utf8");

function isLetter(c) {
    return /[a-zA-Z_]/.test(c);
}

function isNumber(c) {
    return /[0-9]/.test(c);
}

function lexer(input) {
    const tokens = [];
    let i = 0;

    while (i < input.length) {
        let char = input[i];

        if (/\s/.test(char)) {
            i++;
            continue;
        }

        if (char === '"') {
            i++;
            let value = "";

            while (input[i] !== '"' && i < input.length) {
                value += input[i];
                i++;
            }

            i++;
            tokens.push({ type: "STRING", value });
            continue;
        }

        if (isLetter(char)) {
            let value = "";

            while (isLetter(input[i]) || isNumber(input[i])) {
                value += input[i];
                i++;
            }

            if (value === "func") {
                tokens.push({ type: "FUNC" });
            } else if (value === "return") {
                tokens.push({ type: "RETURN" });
            } else {
                tokens.push({ type: "IDENTIFIER", value });
            }

            continue;
        }

        if (char === "(") tokens.push({ type: "LPAREN" });
        else if (char === ")") tokens.push({ type: "RPAREN" });
        else if (char === "{") tokens.push({ type: "LBRACE" });
        else if (char === "}") tokens.push({ type: "RBRACE" });
        else if (char === ".") tokens.push({ type: "DOT" });

        i++;
    }

    return tokens;
}

function parser(tokens) {
    let current = 0;

    function walk() {
        let token = tokens[current];

        if (token.type === "STRING") {
            current++;
            return { type: "StringLiteral", value: token.value };
        }

        if (token.type === "IDENTIFIER") {
            current++;
            return { type: "Identifier", name: token.value };
        }

        if (token.type === "FUNC") {
            current++;

            const name = tokens[current].value;
            current++;

            current++; // (
            current++; // )

            current++; // {

            const body = [];

            while (tokens[current].type !== "RBRACE") {
                body.push(walk());
            }

            current++; // }

            return {
                type: "FunctionDeclaration",
                name,
                body
            };
        }
        if (
            token.type === "LPAREN" ||
            token.type === "RPAREN" ||
            token.type === "RETURN" ||
            token.type === "LBRACE" ||
            token.type === "RBRACE" ||
            token.type === "DOT"
        ) {
            current++;
            return { type: "Symbol", value: token.type };
        }
        throw new TypeError(token.type);
    }

    const ast = {
        type: "Program",
        body: []
    };

    while (current < tokens.length) {
        ast.body.push(walk());
    }

    return ast;
}

function generator(node) {

    switch (node.type) {

        case "Program":
            return node.body.map(generator).join("\n");

        case "FunctionDeclaration":
            return `function ${node.name}() {\n${node.body.map(generator).join("\n")}\n}`;

        case "Identifier":
            return node.name;

        case "StringLiteral":
            return `"${node.value}"`;

        default:
            return "";
    }
}

const tokens = lexer(goCode);
const ast = parser(tokens);
const output = generator(ast);

console.log("TOKENS:");
console.log(tokens);

console.log("\nAST:");
console.log(JSON.stringify(ast, null, 2));

console.log("\nJS OUTPUT:");
console.log(output);
const outputFile = path.join(__dirname, "output.js");
fs.writeFileSync(outputFile, output);
console.log("\nOutput written to:", outputFile);