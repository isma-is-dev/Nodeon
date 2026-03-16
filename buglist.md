Legend:
- LSP: Language Server Protocol
- EXT: VS Code Extension
- CLI: Command Line Interface
- COMP: Compiler
- NOVA: Nova framework
- TEST: Test suite

~~-LSP001: import a module works but it detect variables as no-defined, example:~~ (Fixed)
```no
fs = require("fs")

fs.writeFileSync("hello.txt", "Hello World")
'fs' is not defined nodeon
```