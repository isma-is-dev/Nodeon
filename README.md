# Nodeon

**Nodeon** es un lenguaje de programación que compila a JavaScript. Combina la simplicidad de Python con la robustez de TypeScript, manteniendo compatibilidad total con el ecosistema JS/Node.js.

```
fn greet(name) {
  print("Hello {name}!")
}

greet("World")
```

## Por qué Nodeon

- **Sin ruido** — no semicolons, no paréntesis obligatorios en `if`/`for`/`while`, retornos implícitos
- **Interpolación natural** — `"Hello {name}"` con doble comilla, `'raw strings'` sin interpolación
- **Tipado opcional** — escribe tipos cuando los necesites (roadmap)
- **Igualdad estricta por defecto** — `==` compila a `===`, `!=` a `!==`
- **Ecosistema JS completo** — imports, clases, async/await, todo compila a JS estándar
- **DX primero** — CLI con errores coloreados, extensión VS Code, Language Server

## Instalación

Requisitos: **Node.js 18+**, npm.

```bash
npm install           # dependencias del compilador/CLI
npm test              # ejecutar 109 tests
```

## CLI

```bash
# Compilar .no → .js
node cli/bin.js build hello.no

# Compilar con minificación
node cli/bin.js build -min hello.no

# Compilar y ejecutar en memoria
node cli/bin.js run hello.no

# Versión
node cli/bin.js --version
```

Los errores de compilación muestran línea, columna y caret:
```
error: Unexpected character '@' at 3:5
  --> example.no:3:5
   3 | x = @invalid
     |     ^
```

## Sintaxis rápida

| Nodeon | JavaScript |
|--------|-----------|
| `x = 42` | `let x = 42;` |
| `const PI = 3.14` | `const PI = 3.14;` |
| `fn add(a, b) { a + b }` | `function add(a, b) { return a + b; }` |
| `print("Hello {name}")` | `` console.log(`Hello ${name}`) `` |
| `if x > 0 { ... }` | `if (x > 0) { ... }` |
| `for i in 0..10 { ... }` | `for (let i = 0; i <= 10; i++) { ... }` |
| `for item in items { ... }` | `for (const item of items) { ... }` |
| `x == 5` | `x === 5` |
| `obj?.prop ?? fallback` | `obj?.prop ?? fallback` |
| `x += 1` | `x += 1;` |

### Strings
- **Doble comilla** `"Hello {name}"` — interpolación con `{expr}`
- **Comilla simple** `'raw {no interpolation}'` — literal, sin interpolación
- **Backtick** `` `Hello ${name}` `` — interpolación JS estándar

### Funciones
```
fn double(x) { x * 2 }                    # retorno implícito
fn clamp(v, min = 0, max = 100) { ... }   # parámetros por defecto
fn sum(...nums) { ... }                    # rest parameters
async fn fetch(url) { ... }               # async functions
add = (a, b) => a + b                     # arrow functions
```

### Clases
```
class Dog extends Animal {
  constructor(name) {
    this.name = name
  }

  fn bark() {
    print("{this.name} says Woof!")
  }

  async fn fetch(url) {
    return await get(url)
  }
}
```

### Control de flujo
```
# if / else if / else
if score >= 90 { print("A") }
else if score >= 80 { print("B") }
else { print("F") }

# switch (block-style, sin fall-through accidental)
switch color {
  case "red" { print("Stop") }
  case "green" { print("Go") }
  default { print("Unknown") }
}

# loops
for i in 0..10 { print(i) }
for item in items { print(item) }
while x > 0 { x = x - 1 }
do { x = x - 1 } while x > 0

# break / continue
for i in 0..100 {
  if i == 50 { break }
  if i % 2 == 0 { continue }
  print(i)
}
```

### Operadores
```
# Aritméticos: + - * / % **
# Comparación: == != < > <= >= (== compila a ===)
# Lógicos: && || !
# Asignación compuesta: += -= *= /= %= **= &&= ||= ??=
# Incremento/Decremento: ++ --
# Nullish coalescing: ??
# Optional chaining: ?.
# Rango: ..
# Spread: ...
# Typeof: typeof x
# Instanceof: x instanceof Error
```

### Comentarios
```
# Nodeon-style (preferido)
// JS-style también funciona
/* Bloques multilínea */
```

Para más detalle revisa `nodeon-design.md`.

## Estructura del proyecto

```
src/
  compiler/
    lexer/         # Tokenizador con tracking de línea/columna
    parser/        # Pratt parser con soporte completo ES2020+
    ast/           # Definiciones de nodos AST
    generator/     # Generador de código JS
    compile.ts     # API pública: compile(), compileToAST()
  language/        # Keywords, operadores, tokens, símbolos
cli/               # CLI nodeon (build/run/version)
packages/
  language-server/ # Servidor LSP (diagnostics stub)
  vscode-extension/ # Extensión VS Code (syntax + LSP client)
tests/             # Vitest: lexer, parser, e2e (109 tests)
examples/          # Programas .no de ejemplo
```

## Tests

```bash
npm test              # ejecutar todos los tests
npm run test:watch    # modo watch
```

**109 tests** cubriendo:
- **Lexer** — tokens, números (hex/bin/oct/sci/bigint), strings, template literals, operadores, comentarios, tracking de posición
- **Parser** — declaraciones, funciones, control de flujo, switch, try/catch/finally, expresiones, interpolación, clases, imports
- **E2E** — compilación completa .no → .js verificando output correcto

## Desarrollo

### Compilador / CLI
```bash
npm install
node cli/bin.js build examples/hello.no
node cli/bin.js run examples/features.no
```

### Language Server
```bash
cd packages/language-server
npm install
npm run build
```

### Extensión VS Code
```bash
cd packages/vscode-extension
npm install
npm run build
# F5 en VS Code para debug
```

### Empaquetar VSIX
```bash
cd packages/vscode-extension
npx vsce package
code --install-extension nodeon-vscode-extension-0.0.1.vsix
```

## Roadmap

### Fase actual ✅
- [x] Lexer completo con line/col tracking
- [x] Parser Pratt con soporte ES2020+
- [x] Generador JS con minificación
- [x] CLI build/run con errores coloreados
- [x] 109 tests con Vitest
- [x] Extensión VS Code con syntax highlighting
- [x] Language Server stub

### Próximos pasos 🚧
- [ ] **Type system** — tipado opcional con inferencia
- [ ] **Destructuring** — `{ a, b } = obj`, `[x, y] = arr`
- [ ] **Pattern matching** — `match expr { ... }`
- [ ] **LSP completo** — hover, completions, go-to-definition, formatting
- [ ] **Source maps** — mapear JS output a líneas .no
- [ ] **CI/CD** — GitHub Actions para tests + publicación
- [ ] **npm publish** — `npm install -g nodeon`

### Futuro 🔭
- [ ] **Nodeon stdlib** — wrappers idiomáticos para fs, path, http
- [ ] **Self-hosting** — compilador escrito en Nodeon
- [ ] **WASM target** — compilar a WebAssembly
- [ ] **Bundler integrado** — resolver imports y generar un solo .js

## Licencia

MIT
