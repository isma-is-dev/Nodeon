import { CYAN, DIM, RED, BOLD, RESET, YELLOW } from "./colors";
import { NodeonError } from "@compiler/errors";

export function offsetToLineCol(src: string, offset: number): { line: number; col: number } {
  let line = 1;
  let col = 1;
  for (let i = 0; i < src.length && i < offset; i++) {
    if (src[i] === "\n") {
      line++;
      col = 1;
    } else {
      col++;
    }
  }
  return { line, col };
}

export function formatError(file: string, source: string, err: Error): string {
  const out: string[] = [];

  // Use structured NodeonError if available
  if (err instanceof NodeonError) {
    return formatNodeonError(file, source, err);
  }

  // Fallback for plain SyntaxError or other errors
  out.push(`${RED}${BOLD}error${RESET}: ${err.message}`);

  const match = err.message.match(/at (\d+):(\d+)$/);
  const posMatch = err.message.match(/position\s+(\d+)/i) || err.message.match(/pos(?:ition)?[: ](\d+)/i);

  if (source && (match || posMatch)) {
    let line = 0;
    let col = 0;

    if (match) {
      line = parseInt(match[1], 10);
      col = parseInt(match[2], 10);
    } else if (posMatch) {
      const offset = parseInt(posMatch[1], 10);
      ({ line, col } = offsetToLineCol(source, offset));
    }

    if (line > 0 && col > 0) {
      appendSourceContext(out, file, source, line, col);
      return out.join("\n");
    }
  }

  out.push(`  ${DIM}-->${RESET} ${CYAN}${file}${RESET}`);
  return out.join("\n");
}

function formatNodeonError(file: string, source: string, err: NodeonError): string {
  const out: string[] = [];

  // Header: error[E0101]: Expected ')' at 15:42
  const msgClean = err.message.replace(/\s+at\s+\d+:\d+$/, "");
  out.push(`${RED}${BOLD}error[${err.code}]${RESET}: ${msgClean}`);

  // Source context
  if (source && err.line > 0 && err.column > 0) {
    appendSourceContext(out, file, source, err.line, err.column);
  } else {
    out.push(`  ${DIM}-->${RESET} ${CYAN}${file}${RESET}`);
  }

  // Help suggestions
  if (err.help.length > 0) {
    out.push(`  ${DIM}     ${RESET}`);
    for (const hint of err.help) {
      out.push(`  ${YELLOW}${BOLD}help${RESET}: ${hint}`);
    }
  }

  return out.join("\n");
}

function appendSourceContext(out: string[], file: string, source: string, line: number, col: number): void {
  const srcLines = source.split("\n");
  const lineStr = srcLines[line - 1] ?? "";
  const gutterWidth = String(line).length;
  const gutter = " ".repeat(gutterWidth);

  out.push(`  ${DIM}-->${RESET} ${CYAN}${file}:${line}:${col}${RESET}`);
  out.push(`  ${DIM}${gutter} |${RESET}`);

  // Show the previous line for context if available
  if (line > 1) {
    const prevLine = srcLines[line - 2] ?? "";
    if (prevLine.trim().length > 0) {
      const prevNum = String(line - 1).padStart(gutterWidth);
      out.push(`  ${DIM}${prevNum} |${RESET} ${prevLine}`);
    }
  }

  const lineNum = String(line).padStart(gutterWidth);
  out.push(`  ${DIM}${lineNum} |${RESET} ${lineStr}`);
  out.push(`  ${DIM}${gutter} |${RESET} ${" ".repeat(Math.max(0, col - 1))}${RED}^${RESET}`);
}
