# Nodeon

Nodeon es un lenguaje inspirado en JavaScript diseñado para escribir código más legible y conciso, con tipado opcional por defecto y un flujo de trabajo de compilación a JS para ejecutarse sobre Node.js. Este repositorio contiene el compilador (lexer, parser, generador), la CLI y los paquetes de soporte (language server y extensión de VS Code).

## Por qué Nodeon
- **Sintaxis tersa y familiar**: se mantiene cerca de JS, pero elimina ruido (paréntesis opcionales en llamadas, interpolación simple, retornos implícitos en funciones de una expresión, etc.).
- **Tipado opcional**: puedes declarar tipos cuando los necesites, pero no es obligatorio.
- **Objetivo pragmático**: compila a JavaScript y se ejecuta sobre Node.js hoy; roadmap hacia autohospedaje en el futuro.
- **DX primero**: CLI simple (`build`/`run`), generador con minificación opcional, y tooling (LSP + extensión VS Code) para que .no tenga resaltado y diagnostics.

## Estructura del repo
- `src/` — Código del compilador (lexer, parser, generador). Imports con alias (`@language/...`, `@lexer/...`, `@parser/...`, etc.).
- `cli/` — CLI `nodeon` (build/run) y bin shim.
- `language-server/` — Servidor LSP mínimo para .no (diagnostics stub). Node.js target.
- `vscode-extension/` — Extensión VS Code con gramática TextMate y cliente LSP.
- `examples/` — Ejemplos `.no` y JS.
- `nodeon-design.md` — Documento de diseño y sintaxis del lenguaje.

## Sintaxis rápida (Nodeon → JS)
- Variables: `x = 3`, `const x = 3` (acepta `const/let/var`).
- Funciones: `fn greet(name) { print("Hello {name}") }`
- Arrow: `add = (a, b) => a + b`
- Interpolación: `"Hello {name}"` o `` `Hi ${name}` ``
- Condicionales: `if x > 0 { ... } else { ... }`
- Bucles: `for i in items { ... }`, `while cond { ... }`
- Clases: `class User { constructor(name) { this.name = name } }`
- Imports/exports: `import fs from "fs"`, `export fn foo() { ... }`
- Built-in `print` se mapea a `console.log` en JS.

Para más detalle revisa `nodeon-design.md`.

## Instalación (WSL/Node)
Requisitos: Node.js 18+ (ideal 20), npm.

```bash
# instalar dependencias del compilador/CLI
npm install

# instalar dependencias de subproyectos
default postinstall: npm install --prefix language-server && npm install --prefix vscode-extension
```

## CLI
La CLI vive en `cli/nodeon.ts` (bin: `cli/bin.js`). Comandos:

```bash
# compilar archivo .no a JS (salida .js junto al origen)
node cli/bin.js build path/to/file.no [--min]

# ejecutar .no sin escribir JS en disco
node cli/bin.js run path/to/file.no
```

Flags:
- `--min` / `-min`: minifica la salida JS.

## Desarrollo

### Compilador / CLI
```bash
npm install
npm run build    # (opcional, transpilar si añades TS en CLI)
```

### Language Server
```bash
cd language-server
npm install
npm run build
npm run dev      # ts-node para modo watch
```

### Extensión VS Code (WSL recomendado)
```bash
cd vscode-extension
npm install
npm run build
# Debug: abrir esta carpeta en VS Code (ventana WSL) y pulsar F5 (Run Nodeon Extension)
```

### Empaquetar VSIX (requiere Node 20+)
```bash
cd vscode-extension
npx vsce package
# instala en VS Code (WSL):
code --install-extension nodeon-vscode-extension-0.0.1.vsix
```
Si usas Node 18 y `vsce package` falla por `File is not defined`, cambia a Node 20 (`nvm use 20`).

## Uso de la extensión
- Abre una ventana VS Code en WSL sobre el repo.
- F5 (config "Run Nodeon Extension") para abrir la ventana de pruebas.
- Abre un `.no`: debería activar lenguaje `nodeon`, resaltar con gramática `source.nodeon` y conectar al LSP (diagnóstico Hint si el archivo está vacío).

## Roadmap próximo
- Ampliar LSP: hover, completions, referencias, formateo.
- Tests del generador y del parser (fixtures `.no` → `.js`).
- Mejor runtime: stdlib Nodeon (fs, path, timers) detrás de `NodeonRuntime` para migrar hacia autohospedaje.
- Empaquetado/CI: scripts `build:all`, publicación VSIX.

## Comandos raíz útiles
```bash
npm run build:lsp    # build language-server
npm run build:ext    # build extensión VS Code
npm run build:all    # ambos
```

## Estado actual
- Lexer, parser y generador en TS con alias de paths.
- CLI `build/run` funcional con minificación opcional; `run` ejecuta en memoria (vm) sin escribir JS.
- Gramática mínima y cliente LSP stub (diagnósticos básicos).
- Diseño de lenguaje documentado en `nodeon-design.md`.

## Licencia
MIT
