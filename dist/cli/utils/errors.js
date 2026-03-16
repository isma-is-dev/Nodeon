import { CYAN, DIM, RED, BOLD, RESET, YELLOW } from "./colors.js";
export function offsetToLineCol(src, offset) {
  let line = 1;
  let col = 1;
  let i = 0;
  while (i < src.length && i < offset) {
    if (src[i] === "\n") {
      line = line + 1;
      col = 1;
    } else {
      col = col + 1;
    }
    i = i + 1;
  }
  return { line: line, col: col };
}
export function formatError(file, source, err) {
  const out = [];
  if (err.code && err.line && err.column) {
    return formatNodeonError(file, source, err);
  }
  out.push(RED + BOLD + "error" + RESET + ": " + err.message);
  const locMatch = err.message.match(/at (\d+):(\d+)$/);
  const posMatch = err.message.match(/position\s+(\d+)/i) || err.message.match(/pos(?:ition)?[: ](\d+)/i);
  if (source && (locMatch || posMatch)) {
    let line = 0;
    let col = 0;
    if (locMatch) {
      line = parseInt(locMatch[1], 10);
      col = parseInt(locMatch[2], 10);
    } else if (posMatch) {
      const offset = parseInt(posMatch[1], 10);
      const pos = offsetToLineCol(source, offset);
      line = pos.line;
      col = pos.col;
    }
    if (line > 0 && col > 0) {
      appendSourceContext(out, file, source, line, col);
      return out.join("\n");
    }
  }
  out.push("  " + DIM + "-->" + RESET + " " + CYAN + file + RESET);
  return out.join("\n");
}
function formatNodeonError(file, source, err) {
  const out = [];
  const msgClean = err.message.replace(/\s+at\s+\d+:\d+$/, "");
  out.push(RED + BOLD + "error[" + err.code + "]" + RESET + ": " + msgClean);
  if (source && err.line > 0 && err.column > 0) {
    appendSourceContext(out, file, source, err.line, err.column);
  } else {
    out.push("  " + DIM + "-->" + RESET + " " + CYAN + file + RESET);
  }
  if (err.help && err.help.length > 0) {
    out.push("  " + DIM + "     " + RESET);
    for (const hint of err.help) {
      out.push("  " + YELLOW + BOLD + "help" + RESET + ": " + hint);
    }
  }
  return out.join("\n");
}
function appendSourceContext(out, file, source, line, col) {
  const srcLines = source.split("\n");
  const lineStr = srcLines[line - 1] ?? "";
  const gutterWidth = String(line).length;
  const gutter = " ".repeat(gutterWidth);
  out.push("  " + DIM + "-->" + RESET + " " + CYAN + file + ":" + line + ":" + col + RESET);
  out.push("  " + DIM + gutter + " |" + RESET);
  if (line > 1) {
    const prevLine = srcLines[line - 2] ?? "";
    if (prevLine.trim().length > 0) {
      const prevNum = String(line - 1).padStart(gutterWidth);
      out.push("  " + DIM + prevNum + " |" + RESET + " " + prevLine);
    }
  }
  const lineNum = String(line).padStart(gutterWidth);
  out.push("  " + DIM + lineNum + " |" + RESET + " " + lineStr);
  out.push("  " + DIM + gutter + " |" + RESET + " " + " ".repeat(Math.max(0, col - 1)) + RED + "^" + RESET);
}