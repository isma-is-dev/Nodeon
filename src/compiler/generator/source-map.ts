// ── Source Map V3 Generator ────────────────────────────────────────
// Generates source maps following the V3 specification:
// https://sourcemaps.info/spec.html

export interface SourceMap {
  version: 3;
  file: string;
  sourceRoot: string;
  sources: string[];
  sourcesContent: (string | null)[];
  names: string[];
  mappings: string;
}

export interface Mapping {
  generatedLine: number;   // 1-indexed
  generatedColumn: number; // 0-indexed
  sourceLine: number;      // 1-indexed
  sourceColumn: number;    // 0-indexed
  sourceIndex: number;     // index into sources array
}

export class SourceMapBuilder {
  private mappings: Mapping[] = [];
  private sources: string[] = [];
  private sourcesContent: (string | null)[] = [];
  private names: string[] = [];

  addSource(filename: string, content: string | null = null): number {
    const idx = this.sources.indexOf(filename);
    if (idx >= 0) return idx;
    this.sources.push(filename);
    this.sourcesContent.push(content);
    return this.sources.length - 1;
  }

  addMapping(mapping: Mapping): void {
    this.mappings.push(mapping);
  }

  // Add a simple 1:1 line mapping (sourceLine → generatedLine)
  addLineMapping(sourceLine: number, generatedLine: number, sourceIndex = 0): void {
    this.mappings.push({
      generatedLine,
      generatedColumn: 0,
      sourceLine,
      sourceColumn: 0,
      sourceIndex,
    });
  }

  toJSON(outputFile: string): SourceMap {
    return {
      version: 3,
      file: outputFile,
      sourceRoot: "",
      sources: this.sources,
      sourcesContent: this.sourcesContent,
      names: this.names,
      mappings: this.encodeMappings(),
    };
  }

  toString(outputFile: string): string {
    return JSON.stringify(this.toJSON(outputFile));
  }

  // ── VLQ Encoding ──────────────────────────────────────────────────

  private encodeMappings(): string {
    // Sort mappings by generated line then column
    const sorted = [...this.mappings].sort((a, b) =>
      a.generatedLine - b.generatedLine || a.generatedColumn - b.generatedColumn
    );

    if (sorted.length === 0) return "";

    const lines: string[][] = [];
    let prevGenLine = 1;
    let prevGenCol = 0;
    let prevSourceIndex = 0;
    let prevSourceLine = 0;
    let prevSourceCol = 0;

    for (const m of sorted) {
      // Fill empty lines
      while (prevGenLine < m.generatedLine) {
        lines.push([]);
        prevGenLine++;
        prevGenCol = 0;
      }

      if (!lines[lines.length - 1]) {
        lines.push([]);
      }

      // Each segment: [genColDelta, sourceIndexDelta, sourceLineDelta, sourceColDelta]
      const segment = vlqEncode(m.generatedColumn - prevGenCol)
        + vlqEncode(m.sourceIndex - prevSourceIndex)
        + vlqEncode((m.sourceLine - 1) - prevSourceLine)
        + vlqEncode(m.sourceColumn - prevSourceCol);

      lines[lines.length - 1].push(segment);

      prevGenCol = m.generatedColumn;
      prevSourceIndex = m.sourceIndex;
      prevSourceLine = m.sourceLine - 1;
      prevSourceCol = m.sourceColumn;
    }

    return lines.map((segs) => segs.join(",")).join(";");
  }
}

// ── VLQ Base64 Encoding ─────────────────────────────────────────────

const VLQ_BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const VLQ_BASE_SHIFT = 5;
const VLQ_BASE = 1 << VLQ_BASE_SHIFT; // 32
const VLQ_BASE_MASK = VLQ_BASE - 1;   // 31
const VLQ_CONTINUATION_BIT = VLQ_BASE; // 32

function vlqEncode(value: number): string {
  let vlq = value < 0 ? ((-value) << 1) + 1 : (value << 1);
  let encoded = "";

  do {
    let digit = vlq & VLQ_BASE_MASK;
    vlq >>>= VLQ_BASE_SHIFT;
    if (vlq > 0) {
      digit |= VLQ_CONTINUATION_BIT;
    }
    encoded += VLQ_BASE64[digit];
  } while (vlq > 0);

  return encoded;
}
