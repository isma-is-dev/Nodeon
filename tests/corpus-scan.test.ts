// How much of the repository's OWN Nodeon source compiles in the WASM backend?
//
// This is the measurement that says what the backend is actually worth, and it
// is the one that found four defects no feature list had: a function that
// returns nothing, a method looked up on the prototype chain, an `else` emitted
// on a void `if`, and an arm that swallowed the next one.
//
// It is a gate, not a test: it compiles every `.no` file in the repo, which
// takes seconds, and a measurement you run once is not a test. It is skipped
// unless asked for:
//
//     NODEON_CORPUS_SCAN=1 npx vitest run tests/corpus-scan.test.ts
//
// The number it prints is the honest measure of coverage. When it goes up, the
// backend got better at real code; when it goes down, something broke.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { linkProgram } from "@compiler/ir/ir-modules";
import { compileIRToWasmBinary } from "@compiler/ir";

const RUN = process.env.NODEON_CORPUS_SCAN === "1";

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".git" || name === "dist") continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (name.endsWith(".no")) out.push(full);
  }
  return out;
}

type Verdict = "VALID" | "INVALID" | "PARSE" | "DIAG" | "THREW";

/** Resolve a specifier the way the CLI does: relative to the importing file. */
function resolveSpec(spec: string, from: string): string | null {
  if (!spec.startsWith(".") && !spec.startsWith("/")) return null;
  const base = path.resolve(path.dirname(from), spec);
  for (const candidate of [base, `${base}.no`, path.join(base, "index.no")]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

const reader = { read: (f: string) => readFileSync(f, "utf8"), resolvePath: resolveSpec };

/** Every file a program reaches, imports followed. The key is the SET, sorted. */
function programKey(entry: string): string {
  const seen = new Set<string>();
  const queue = [path.resolve(entry)];
  while (queue.length) {
    const f = queue.pop()!;
    if (seen.has(f)) continue;
    seen.add(f);
    let src: string;
    try {
      src = readFileSync(f, "utf8");
    } catch {
      continue;
    }
    for (const m of /from\s+["']([^"']+)["']/g.exec(src) ?? []) {
      const target = resolveSpec(m[1], f);
      if (target && !seen.has(target)) queue.push(target);
    }
  }
  return [...seen].sort().join("|");
}

describe.skipIf(!RUN)("WASM backend: the repository's own source", () => {
  it("compiles every .no file it can find", () => {
    const files = [...walk("examples"), ...walk("src")];
    const results: { file: string; verdict: Verdict; detail: string; gaps: string[] }[] = [];
    // Files are optional: `NODEON_CORPUS_FILES=lint.no,new.no` measures a few
    // quickly. The full sweep of a large file can take minutes.
    const only = process.env.NODEON_CORPUS_FILES;
    const wanted = only ? new Set(only.split(",")) : null;

    // **Compile each PROGRAM once, not once per file that reaches it.**
    //
    // Fifty corpus files link into far fewer distinct programs — the self-hosted
    // compiler's modules share one graph — and each graph was being lowered,
    // emitted, encoded and VALIDATED again for every file that happened to
    // import it. The same functions were compiled a dozen times, and the gate
    // stopped finishing: it was killed at 280s with nothing written, because the
    // report is written at the end. A gate that takes longer than you will wait
    // is a gate that does not run, and a gate that does not run measures nothing.
    //
    // The file-level report is unchanged: a file is judged by the verdict of the
    // program it belongs to, which is the same thing it was judging before.
    const byProgram = new Map<string, { entry: string; verdict: Verdict; detail: string; gaps: string[] }>();

    for (const file of files) {
      if (wanted && !wanted.has(path.basename(file))) continue;
      const key = programKey(file);
      const cached = byProgram.get(key);
      if (cached) {
        results.push({ file, verdict: cached.verdict, detail: cached.detail, gaps: cached.gaps });
        continue;
      }
      let verdict: Verdict = "THREW";
      let detail = "";
      // EVERY diagnostic, not just the first. One line per program turned 38
      // refused programs into a reported 18, and the list of what is missing is
      // the only thing this gate is for — a tally that keeps one item per row is
      // an inventory, not a measurement.
      const all: string[] = [];
      try {
        // A PROGRAM, not a file: the imports are followed and every file lands
        // in one module. Measuring file by file said a backend without a linker
        // could reach exactly one file, which was true and useless.
        const linked = linkProgram(path.resolve(file), { ...reader, root: process.cwd() });
        if (linked.problems.length) {
          verdict = "PARSE";
          detail = linked.problems[0].slice(0, 110);
        } else if (linked.module.diagnostics?.length) {
          // The compiler REFUSING an unsupported program is a reported gap, not
          // a crash. Letting it throw made 29 files report as "threw" when the
          // truth was "uses try/catch".
          verdict = "DIAG";
          all.push(...(linked.module.diagnostics as string[]));
          detail = all[0].slice(0, 120);
        } else {
          const bytes = compileIRToWasmBinary(linked.module);
          if (!WebAssembly.validate(bytes)) {
            verdict = "INVALID";
            try {
              new WebAssembly.Module(bytes);
            } catch (e) {
              detail = (e as Error).message.replace(/\s+/g, " ").slice(0, 160);
            }
          } else {
            new WebAssembly.Instance(new WebAssembly.Module(bytes), {});
            verdict = "VALID";
          }
        }
      } catch (e) {
        // **The RAW message, not the collapsed one.** The emitter reports a refusal
        // as a header followed by one line per thing it will not do, and collapsing
        // the newlines BEFORE splitting on them left the split with nothing: one
        // program with forty gaps was counted as one with one. Measured on the
        // repository's own lexer, which this said was one gap away and was forty.
        //
        // Whitespace is collapsed only WITHIN a line, which is what the per-line
        // display wants and does not touch the structure.
        const rawMessage = (e as Error).message || "";
        const message = rawMessage.replace(/[\t ]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();
        // A REFUSAL is not a crash, and calling it one made this gate assert
        // against the compiler's own honesty: `compileIRToWasmBinary` throws when
        // the emitter names something it will not do, so a module that used to be
        // counted as `INVALID` — or even as `VALID` — arrived here as `THREW` and
        // failed the gate that exists to prove the compiler never throws on real
        // code.
        //
        // The compiler never crashed; it said no. Three verdicts, and the third is
        // what gives the other two their meaning: compiled / refused / crashed.
        if (message.startsWith("no se puede compilar a WebAssembly:")) {
          verdict = "DIAG";
          // EVERY line after the header, so the tally counts what is actually
          // missing rather than what is missing first.
          // A single-line refusal still has to be counted as something, or the
          // tally would drop it entirely — which is the other half of the same bug.
          const after = rawMessage
            .split("\n")
            .slice(1)
            .map((l) => l.replace(/^[\s-]+/, "").trim())
            .filter(Boolean);
          const gapsHere = after.length
            ? after
            : [message.replace(/^no se puede compilar a WebAssembly:\s*-?\s*/, "")];
          all.push(...gapsHere);
          detail = gapsHere[0].slice(0, 120);
        } else {
          detail = message.split("\n")[0].slice(0, 160);
        }
      }
      byProgram.set(key, { entry: file, verdict, detail, gaps: all });
      results.push({ file, verdict, detail, gaps: all });
    }
    const programs = byProgram.size;

    const tally: Record<Verdict, number> = { VALID: 0, INVALID: 0, PARSE: 0, DIAG: 0, THREW: 0 };
    // Gaps by NAME, because "49 files do not compile" says nothing about what
    // to build next. If forty of them want `import`, then the backend needs
    // modules and everything else is a footnote.
    //
    // And EVERY diagnostic a program produced, not the first: one line per row
    // reported 18 host calls where there are 38, because a program is refused
    // once for the first thing it does that this backend will not do.
    const gaps = new Map<string, number>();
    for (const r of results) {
      tally[r.verdict]++;
      if (r.verdict !== "DIAG") continue;
      const lines = r.gaps?.length ? r.gaps : [r.detail];
      for (const line of lines) {
        // The NAME is the actionable part, so extract it from all three shapes a
        // refusal takes: a sentence, a call to an unknown callee, and a call to a
        // host member. Without the third, 18 refusals collapsed into one line of
        // prose that says nothing about what to build.
        const m =
          /miembro \("([^"]+)"\)/.exec(line) ??
          /"(?:sentencia|llamada) ([^"]+)"/.exec(line);
        const key = m ? m[1] : line.slice(0, 60);
        gaps.set(key, (gaps.get(key) ?? 0) + 1);
      }
    }
    const report = [
      `files ${results.length} · programs ${programs} · valid ${tally.VALID} · invalid ${tally.INVALID} · ` +
        `parse ${tally.PARSE} · diagnostics ${tally.DIAG} · threw ${tally.THREW}`,
      "",
      "=== what is missing, by name ===",
      ...[...gaps.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([k, n]) => `${String(n).padStart(4)}  ${k}`),
      "",
      "=== per program (one compilation each) ===",
      ...[...byProgram.values()].map(
        (p) => `${p.verdict.padEnd(8)} ${p.entry}${p.detail ? "  " + p.detail : ""}`,
      ),
    ].join("\n");
    writeFileSync(path.resolve(__dirname, "..", ".mavis-probe", "corpus.txt"), report, "utf8");
    // eslint-disable-next-line no-console
    console.log(report.split("\n").slice(0, 3 + gaps.size).join("\n"));

    // **The gate checks its OWN instrument before it trusts its tally.** One
    // collected gap must be exactly one refusal.
    //
    // Every refusal this backend produces ends in the same clause, so a gap that
    // holds two of them is a message that was not split — and the tally below is
    // then built on a count that lost something. It happened: the newlines were
    // collapsed before the split, one program with forty gaps was counted as one,
    // and `valid 7` was reported for the whole of it. See BUG-WASM-43.
    //
    // Nothing here is about the compiler. It is about whether the number being
    // printed is the number that exists, which is the one thing an instrument has
    // to be able to say about itself.
    const REFUSAL_MARKER = "todavía no está soportad";
    const lossy: string[] = [];
    for (const r of results) {
      for (const line of r.gaps ?? []) {
        const n = line.split(REFUSAL_MARKER).length - 1;
        if (n > 1) {
          lossy.push(`${r.file}: one gap holds ${n} refusals — ${line.slice(0, 90)}`);
        }
      }
    }
    if (lossy.length) {
      throw new Error(
        `la puerta perdió rechazos al contarlos, y su lista de huecos no es de fiar:` +
          `\n  ${lossy.slice(0, 8).join("\n  ")}`
      );
    }

    // The compiler must never THROW on real code. Every other outcome is a
    // reported gap; a crash is a defect in the compiler.
    expect(results.filter((r) => r.verdict === "THREW")).toEqual([]);
  });
});
