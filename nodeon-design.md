# Nodeon Language -- Design Rules (v0.1)

Nodeon is an experimental programming language designed to simplify
syntax while staying compatible with the JavaScript ecosystem.\
The goal is to provide a developer experience similar to Python while
maintaining explicit block structures using braces.

------------------------------------------------------------------------

# 1. Core Philosophy

Nodeon follows these design principles:

-   Minimal syntax
-   No semicolons
-   Explicit block delimiters using `{}`
-   Simple function definitions
-   Implicit return for single-expression blocks
-   Explicit return required for multi-expression blocks
-   Direct compilation to JavaScript

------------------------------------------------------------------------

# 2. File Extension

Nodeon source files use the `.no` extension.

Example:

    hello.no
    math.no
    server.no

------------------------------------------------------------------------

# 3. Variables

Variables are declared using assignment without keywords.

Nodeon:

    x = 10
    name = "Ismael"

Generated JavaScript:

    let x = 10
    let name = "Ismael"

------------------------------------------------------------------------

# 4. Functions

Functions are declared using the `fn` keyword.

Nodeon:

    fn greet(name) {
      print("Hello " + name)
    }

Generated JavaScript:

    function greet(name){
      console.log("Hello " + name)
    }

------------------------------------------------------------------------

# 5. Function Return Rules

Nodeon uses **conditional implicit returns**.

### Rule

-   If a function body contains **only one expression**, that expression
    becomes the return value automatically.
-   If a function body contains **multiple expressions**, an explicit
    `return` is required.

### Valid Example

    fn sum(a,b) {
      a + b
    }

Generated JavaScript:

    function sum(a,b){
      return a + b
    }

### Required Explicit Return

    fn sum(a,b) {
      temp = a + b
      return temp * 2
    }

------------------------------------------------------------------------

# 6. Expression-style Functions

Short functions can use the `=` syntax.

Nodeon:

    fn sum(a,b) = a + b

Generated JavaScript:

    function sum(a,b){
      return a + b
    }

------------------------------------------------------------------------

# 7. Conditionals

Nodeon conditionals omit parentheses.

Nodeon:

    if age > 18 {
      print("adult")
    } else {
      print("minor")
    }

Generated JavaScript:

    if(age > 18){
      console.log("adult")
    }else{
      console.log("minor")
    }

------------------------------------------------------------------------

# 8. Loops

Range-based loops use the `..` operator.

Nodeon:

    for i in 0..10 {
      print(i)
    }

Generated JavaScript:

    for(let i = 0; i <= 10; i++){
      console.log(i)
    }

------------------------------------------------------------------------

# 9. Imports

Nodeon supports JavaScript-style imports.

Nodeon:

    import fs from "fs"

Generated JavaScript:

    import fs from "fs"

------------------------------------------------------------------------

# 10. Built-in Functions

Some built-ins map directly to JavaScript equivalents.

Example:

    print()

compiles to

    console.log()

------------------------------------------------------------------------

# 11. String Interpolation

String interpolation uses curly braces inside strings.

Example:
"Hello {name}"
"Total: {price * quantity}"

------------------------------------------------------------------------

# 12. Syntax Simplifications

Nodeon removes several elements common in JavaScript:

-   No semicolons
-   No `function` keyword
-   No `let` / `const` keywords
-   Optional return in simple functions
-   Cleaner conditional syntax

------------------------------------------------------------------------

# 13. Example Program

Nodeon:

    fn sum(a,b) {
      a + b
    }

    result = sum(5,7)

    if result > 10 {
      print("big")
    } else {
      print("small")
    }

Generated JavaScript:

    function sum(a,b){
      return a + b
    }

    let result = sum(5,7)

    if(result > 10){
      console.log("big")
    }else{
      console.log("small")
    }

------------------------------------------------------------------------

# Future Ideas

Possible future features for Nodeon:

-   Optional type system
-   Pattern matching
-   Async simplification
-   Direct WebAssembly compilation
-   Native Node.js tooling integration
