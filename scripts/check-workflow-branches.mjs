#!/usr/bin/env node
/**
 * Every workflow must trigger on branches that exist.
 *
 * WHY THIS EXISTS
 * ---------------
 * A workflow that triggers on a branch the repository does not have does not
 * fail. It never starts. The gates it was supposed to run stay "green" for
 * ever, because nothing ran them and nothing reported the absence. A missing
 * run and a passing run look exactly the same from the outside.
 *
 * There is a second version of the same defect, and it is the worse one: the
 * trigger names a branch that does exist, but not the branch everyone merges
 * into. The workflow runs, it is green, and the trunk is still unverified. So
 * this check asserts two things, not one.
 *
 * It is not a theory. A workflow that triggers on a branch the repository
 * does not have never starts, and never fails either: the gates it was
 * supposed to run stay "green" for ever, because nothing ran them and
 * nothing reported the absence. The same shape is possible in any repository
 * that has a workflow, which is why the check is here, next to the workflows
 * it protects, and why the workflow that runs it has no branch filter at all.
 *
 * WHAT IT CHECKS
 * --------------
 *  1. Every branch named in a trigger exists in the repository.
 *  2. Every trigger that filters by branch still covers the trunk, so the
 *     state people merge into is the state that was verified.
 *  3. At least one workflow triggers on every push. That workflow is the one
 *     that runs this script, and it is the reason this check cannot be
 *     silenced by the very mistake it exists to catch.
 *
 * WHY NO YAML PARSER
 * ------------------
 * A gate that needs a dependency is a gate that gets skipped, and this one only
 * has to read an `on:` block. So the block is read with a small
 * indentation-aware scanner instead of a parser. The scanner is exercised by
 * `check-workflow-branches.test.mjs`, which plants real workflows and asserts
 * what this file does with them.
 *
 * Bracket patterns (`+`, `[]`) are not interpreted; only `*` and `?` are
 * treated as wildcards. GitHub supports more, and a branch name that contains
 * them is rare enough that reading them literally is the safer error.
 *
 * USAGE
 *   node scripts/check-workflow-branches.mjs
 *   node scripts/check-workflow-branches.test.mjs
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WORKFLOW_DIR = join(ROOT, '.github', 'workflows');

// ---------------------------------------------------------------------------
// Reading the trigger block
// ---------------------------------------------------------------------------

/** Cut a trailing YAML comment that is not inside a quoted string. */
function stripComment(value) {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === '"' && !inSingle) inDouble = !inDouble;
    else if (ch === '#' && !inSingle && !inDouble && (i === 0 || /\s/.test(value[i - 1]))) {
      return value.slice(0, i);
    }
  }
  return value;
}

/** Remove the quotes YAML puts around a scalar. */
function unquote(value) {
  const trimmed = value.trim();
  if (trimmed.length >= 2) {
    const quoted = (trimmed.startsWith('"') && trimmed.endsWith('"'))
      || (trimmed.startsWith("'") && trimmed.endsWith("'"));
    if (quoted) return trimmed.slice(1, -1);
  }
  return trimmed;
}

/** Read a YAML flow sequence: `[main, 'release/**']`. */
function parseFlowList(value) {
  const inner = value.trim().replace(/^\[/, '').replace(/\]$/, '');
  if (!inner.trim()) return [];
  return inner
    .split(',')
    .map((item) => unquote(stripComment(item).trim()))
    .filter((item) => item !== '');
}

/** Read the branch filters out of a flow mapping: `{branches: [main]}`. */
function parseFlowMapping(value) {
  const inner = value.trim().replace(/^\{/, '').replace(/\}$/, '');
  const branches = inner.match(/(?:^|,)\s*branches\s*:\s*\[([^\]]*)\]/);
  const ignore = inner.match(/(?:^|,)\s*branches-ignore\s*:\s*\[([^\]]*)\]/);
  return {
    branches: branches ? parseFlowList(branches[1]) : null,
    branchesIgnore: ignore ? parseFlowList(ignore[1]) : null,
  };
}

/**
 * Read the `on:` block of a workflow.
 *
 * Returns the events it triggers on, each with the branch filters it applies
 * (`null` meaning "no filter", which is every branch).
 */
export function parseTriggers(text) {
  const lines = text.split(/\r?\n/);
  const events = {};
  const problems = [];

  let onIndex = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '' || /^\s*#/.test(line)) continue;
    if (/^(?:on|"on"|'on')\s*:/.test(line)) {
      onIndex = i;
      break;
    }
  }

  if (onIndex === -1) {
    return { events, problems: ['no top-level `on:` key — the workflow never triggers'] };
  }

  const inline = stripComment(lines[onIndex].replace(/^(?:on|"on"|'on')\s*:/, '')).trim();

  // `on: [push, pull_request]` — legal YAML, and it filters nothing.
  if (inline.startsWith('[')) {
    for (const event of parseFlowList(inline)) events[event] = { branches: null, branchesIgnore: null };
    return { events, problems };
  }

  // `on: {push: {branches: [main]}}` — legal YAML, and rare.
  if (inline.startsWith('{')) {
    const parsed = parseFlowMapping(inline);
    for (const name of inline.matchAll(/([A-Za-z0-9_-]+)\s*:/g)) {
      const event = name[1];
      if (event === 'branches' || event === 'branches-ignore') continue;
      events[event] = { branches: parsed.branches, branchesIgnore: parsed.branchesIgnore };
    }
    return { events, problems };
  }

  // The block form: `on:` and then indented events under it.
  let event = null;
  let key = null;

  for (let i = onIndex + 1; i < lines.length; i++) {
    const raw = lines[i];
    if (raw.trim() === '' || /^\s*#/.test(raw)) continue;

    const indent = raw.length - raw.trimStart().length;
    if (indent === 0) break; // the next top-level key ends the `on:` block

    const content = raw.trim();

    if (indent <= 2) {
      const match = content.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
      if (!match) {
        problems.push(`cannot read line ${i + 1}: ${content}`);
        event = null;
        key = null;
        continue;
      }
      event = match[1];
      events[event] ??= { branches: null, branchesIgnore: null };
      key = null;

      const rest = stripComment(match[2]).trim();
      if (rest.startsWith('{')) {
        const parsed = parseFlowMapping(rest);
        events[event].branches = parsed.branches;
        events[event].branchesIgnore = parsed.branchesIgnore;
        event = null;
      } else if (rest !== '') {
        event = null; // a scalar value: `push: something`
      }
      continue;
    }

    if (!event) continue;

    const match = content.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
    if (match) {
      key = null;
      const name = match[1];
      const rest = stripComment(match[2]).trim();
      if (name === 'branches' || name === 'branches-ignore') {
        // `branches-ignore` is stored under the same name the rest of this
        // file uses, so the two spellings of the same filter cannot drift.
        key = name === 'branches' ? 'branches' : 'branchesIgnore';
        if (rest.startsWith('[')) {
          events[event][key] = parseFlowList(rest);
          key = null;
        } else if (rest !== '') {
          events[event][key] = [unquote(rest)];
          key = null;
        }
      }
      continue;
    }

    if (content.startsWith('- ') || content === '-') {
      if (key) {
        const value = unquote(stripComment(content.slice(1)).trim());
        if (value) (events[event][key] ??= []).push(value);
      }
      continue;
    }

    problems.push(`cannot read line ${i + 1}: ${content}`);
  }

  return { events, problems };
}

// ---------------------------------------------------------------------------
// Branch patterns
// ---------------------------------------------------------------------------

/** Is this a pattern rather than a branch name? */
function isPattern(pattern) {
  return /[*?]/.test(pattern);
}

/**
 * Turn a GitHub branch filter into a regular expression.
 *
 * `*` does not cross a `/`, `**` does, and `?` is a single character that
 * does not cross a `/`. Everything else is literal.
 */
function patternToRegExp(pattern) {
  let source = '';
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === '*') {
      if (pattern[i + 1] === '*') {
        source += '.*';
        i += 1;
      } else {
        source += '[^/]*';
      }
      continue;
    }
    if (ch === '?') {
      source += '[^/]';
      continue;
    }
    source += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${source}$`);
}

/** Does this pattern select the given branch? */
function selects(pattern, branch) {
  return isPattern(pattern) ? patternToRegExp(pattern).test(branch) : pattern === branch;
}

// ---------------------------------------------------------------------------
// The rules
// ---------------------------------------------------------------------------

/**
 * Check the workflows against the branches that exist.
 *
 * `existing` is the list of branch names; `trunk` is the branch people merge
 * into, or null when it could not be determined.
 */
export function evaluate(workflows, { existing, trunk }) {
  const findings = [];
  let canary = false;

  for (const workflow of workflows) {
    for (const problem of workflow.problems ?? []) {
      findings.push(`${workflow.name}: ${problem}`);
    }

    for (const [event, spec] of Object.entries(workflow.events ?? {})) {
      if (spec.branches) {
        const included = spec.branches.filter((branch) => !branch.startsWith('!'));
        const excluded = spec.branches.filter((branch) => branch.startsWith('!')).map((branch) => branch.slice(1));

        for (const pattern of included) {
          const matched = existing.some((branch) => selects(pattern, branch));
          if (!matched) {
            const how = isPattern(pattern) ? 'matches no branch in' : 'does not exist in';
            findings.push(`${workflow.name}: ${event} triggers on "${pattern}", which ${how} the repository`);
          }
        }

        const covered = existing.filter((branch) => included.some((pattern) => selects(pattern, branch))
          && !excluded.some((pattern) => selects(pattern, branch)));
        if (trunk && !covered.includes(trunk)) {
          findings.push(`${workflow.name}: ${event} does not trigger on the trunk branch "${trunk}" — the state people merge into would never be verified`);
        }
      } else if (spec.branchesIgnore) {
        if (trunk && spec.branchesIgnore.some((pattern) => selects(pattern, trunk))) {
          findings.push(`${workflow.name}: ${event} ignores the trunk branch "${trunk}" — the state people merge into would never be verified`);
        }
      } else if (event === 'push') {
        // A push with no filter at all: this workflow runs on every push.
        canary = true;
      }
    }
  }

  if (!canary) {
    findings.push('no workflow triggers on every push: a wrong branch filter could silence the check that catches it');
  }

  return findings;
}

// ---------------------------------------------------------------------------
// The repository
// ---------------------------------------------------------------------------

/** Run git and return its output, or null when it failed. */
function git(args, timeoutMs = 30_000, cwd = ROOT) {
  const result = spawnSync('git', args, { encoding: 'utf8', timeout: timeoutMs, cwd });
  return result.status === 0 ? (result.stdout ?? '') : null;
}

/** The remote to ask. `origin` when it exists, otherwise the first one. */
export function pickRemote(cwd = ROOT) {
  const remotes = (git(['remote'], 30_000, cwd) ?? '').split('\n').map((line) => line.trim()).filter(Boolean);
  if (remotes.includes('origin')) return 'origin';
  return remotes[0] ?? null;
}

/**
 * Every branch this repository has.
 *
 * The remote is the authority. `ls-remote` is the only list that cannot be
 * out of date, and it is the only list the server can trigger on.
 *
 * The branches this clone has seen are NOT added to it. They used to be, and
 * that made the gate blind in the repository that needed it most: `even2me`
 * has a second remote (`nebula`), which is a different repository. Its
 * branches were merged into this repository's, and `develop` — a branch
 * that only the other repository has — made the check believe the broken
 * trigger was fine. A stale tracking ref does the same.
 *
 * When the remote cannot be asked, the tracking refs of that remote are used
 * instead, scoped to it for the same reason.
 */
export function existingBranches(remote, cwd = ROOT) {
  const branches = new Set();

  // What the remote has right now.
  if (remote) {
    const heads = git(['ls-remote', '--heads', remote], 30_000, cwd) ?? '';
    for (const line of heads.split('\n')) {
      const ref = line.split('\t')[1];
      if (ref && ref.startsWith('refs/heads/')) branches.add(ref.slice('refs/heads/'.length));
    }
  }

  // Only when the remote could not be asked: what this clone has seen.
  // Scoped to the remote that was chosen, because a second remote is a
  // different repository and its branches are not this one's.
  if (branches.size === 0) {
    const scope = remote ? `refs/remotes/${remote}` : 'refs/remotes';
    const tracking = git(['for-each-ref', '--format=%(refname:strip=3)', scope], 30_000, cwd) ?? '';
    for (const line of tracking.split('\n')) {
      const name = line.trim();
      if (name && name !== 'HEAD') branches.add(name);
    }
  }

  // A branch that only exists in this working copy is not a branch the
  // remote can trigger on, so it is deliberately not counted here.

  return [...branches].sort();
}

/** The branch people merge into: the one the remote points its HEAD at. */
export function trunkBranch(remote, cwd = ROOT) {
  if (remote) {
    const symref = git(['ls-remote', '--symref', remote, 'HEAD'], 30_000, cwd) ?? '';
    const match = symref.match(/ref:\s+refs\/heads\/([^\s]+)\s+HEAD/);
    if (match) return match[1];
  }
  const symbolic = git(['symbolic-ref', '--short', `refs/remotes/${remote ?? 'origin'}/HEAD`], 30_000, cwd);
  if (symbolic) {
    const name = symbolic.trim().replace(/^[^/]+\//, '');
    if (name) return name;
  }
  return null;
}

/** Every workflow in the repository. */
export function readWorkflows() {
  if (!existsSync(WORKFLOW_DIR)) {
    console.error(`workflow-branches: ${WORKFLOW_DIR} does not exist — there is no CI to check`);
    process.exit(2);
  }
  const files = readdirSync(WORKFLOW_DIR)
    .filter((file) => file.endsWith('.yml') || file.endsWith('.yaml'))
    .sort();
  return files.map((file) => {
    const text = readFileSync(join(WORKFLOW_DIR, file), 'utf8');
    const { events, problems } = parseTriggers(text);
    return { name: file, events, problems };
  });
}

// ---------------------------------------------------------------------------
// Running it
// ---------------------------------------------------------------------------

function check() {
  const workflows = readWorkflows();
  const remote = pickRemote();
  const existing = existingBranches(remote);
  const trunk = trunkBranch(remote);

  if (existing.length === 0) {
    console.error('workflow-branches: could not determine the branches of this repository — nothing was verified');
    process.exit(2);
  }

  const findings = evaluate(workflows, { existing, trunk });

  if (findings.length === 0) {
    console.log(`workflow-branches: clean — ${workflows.length} workflow(s), ${existing.length} branch(es) (${existing.join(', ')}), trunk "${trunk ?? 'unknown'}" covered.`);
    process.exit(0);
  }

  console.error(`workflow-branches: ${findings.length} problem(s):`);
  for (const finding of findings) console.error(`  ${finding}`);
  process.exit(1);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  check();
}
