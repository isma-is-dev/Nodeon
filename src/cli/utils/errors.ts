import { CYAN, DIM, RED, BOLD, RESET } from "./colors";

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
  const lines: string[] = [];
  lines.push(`${RED}${BOLD}error${RESET}: ${err.message}`);

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
      const srcLines = source.split("\n");
      const lineStr = srcLines[line - 1] ?? "";
      const lineNum = String(line).padStart(4);
      lines.push(`  ${DIM}-->${RESET} ${CYAN}${file}:${line}:${col}${RESET}`);
      lines.push(`  ${DIM}${lineNum} |${RESET} ${lineStr}`);
      lines.push(`  ${DIM}${" ".repeat(4)} |${RESET} ${" ".repeat(col - 1)}${RED}^${RESET}`);
      return lines.join("\n");
    }
  }

  lines.push(`  ${DIM}-->${RESET} ${CYAN}${file}${RESET}`);
  return lines.join("\n");
}
