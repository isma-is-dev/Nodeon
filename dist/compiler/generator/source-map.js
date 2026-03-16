const VLQ_BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const VLQ_BASE_SHIFT = 5;
const VLQ_BASE = 1 << VLQ_BASE_SHIFT;
const VLQ_BASE_MASK = VLQ_BASE - 1;
const VLQ_CONTINUATION_BIT = VLQ_BASE;
function vlqEncode(value) {
  let vlq = value < 0 ? (-value << 1) + 1 : value << 1;
  let encoded = "";
  do {
    let digit = vlq & VLQ_BASE_MASK;
    vlq = vlq >>> VLQ_BASE_SHIFT;
    if (vlq > 0) {
      digit = digit | VLQ_CONTINUATION_BIT;
    }
    encoded = encoded + VLQ_BASE64[digit];
  } while (vlq > 0);
  return encoded;
}
export class SourceMapBuilder {
  constructor() {
    this.mappings = [];
    this.sources = [];
    this.sourcesContent = [];
    this.names = [];
  }

  addSource(filename, content) {
    const idx = this.sources.indexOf(filename);
    if (idx >= 0) {
      return idx;
    }
    this.sources.push(filename);
    this.sourcesContent.push(content ?? null);
    return this.sources.length - 1;
  }

  addMapping(mapping) {
    return this.mappings.push(mapping);
  }

  addLineMapping(sourceLine, generatedLine, sourceIndex) {
    return this.mappings.push({ generatedLine: generatedLine, generatedColumn: 0, sourceLine: sourceLine, sourceColumn: 0, sourceIndex: sourceIndex ?? 0 });
  }

  toJSON(outputFile) {
    return { version: 3, file: outputFile, sourceRoot: "", sources: this.sources, sourcesContent: this.sourcesContent, names: this.names, mappings: this.encodeMappings() };
  }

  toString(outputFile) {
    return JSON.stringify(this.toJSON(outputFile));
  }

  encodeMappings() {
    const sorted = [...this.mappings].sort((a, b) => a.generatedLine - b.generatedLine || a.generatedColumn - b.generatedColumn);
    if (sorted.length === 0) {
      return "";
    }
    const lines = [];
    let prevGenLine = 1;
    let prevGenCol = 0;
    let prevSourceIndex = 0;
    let prevSourceLine = 0;
    let prevSourceCol = 0;
    for (const m of sorted) {
      while (prevGenLine < m.generatedLine) {
        lines.push([]);
        prevGenLine = prevGenLine + 1;
        prevGenCol = 0;
      }
      if (!lines[lines.length - 1]) {
        lines.push([]);
      }
      const segment = vlqEncode(m.generatedColumn - prevGenCol) + vlqEncode(m.sourceIndex - prevSourceIndex) + vlqEncode(m.sourceLine - 1 - prevSourceLine) + vlqEncode(m.sourceColumn - prevSourceCol);
      lines[lines.length - 1].push(segment);
      prevGenCol = m.generatedColumn;
      prevSourceIndex = m.sourceIndex;
      prevSourceLine = m.sourceLine - 1;
      prevSourceCol = m.sourceColumn;
    }
    return lines.map(segs => segs.join(",")).join(";");
  }
}