import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import {
  parseTriggers,
  evaluate,
  readWorkflows,
  pickRemote,
  existingBranches,
  trunkBranch,
} from './check-workflow-branches.mjs';

/**
 * The trunk of this repository.
 *
 * It is `main`, and the difference is the whole point of the gate: a
 * workflow that triggers on a branch this repository does not have never
 * starts, and never fails either. So the cases below are written against the
 * branch that really exists, and the trunk is asked of the repository rather
 * than assumed, so a repository that changes its trunk does not turn this
 * file into a test of a fiction.
 */
const TRUNK = 'main';

/** A workflow built out of YAML text, the way the repository would hold it. */
function wf(name, text) {
  const { events, problems } = parseTriggers(text);
  return { name, events, problems };
}

/** The workflow that runs the gate: a push with no branch filter. */
const CANARY = wf('workflow-guards.yml', 'on:\n  push:\n');

/** The findings a set of workflows produces against a known set of branches. */
function findingsFor(workflows, { existing = [TRUNK, 'feature/una'], trunk = TRUNK } = {}) {
  return evaluate([CANARY, ...workflows], { existing, trunk });
}

describe('the trigger reader', () => {
  test('a block list is read like a flow list', () => {
    const { events } = parseTriggers('on:\n  push:\n    branches:\n      - main\n      - feature/una\n');
    assert.deepEqual(events.push.branches, ['main', 'feature/una']);
  });

  test('a flow list is read', () => {
    const { events } = parseTriggers('on:\n  push:\n    branches: [main, feature/una]\n');
    assert.deepEqual(events.push.branches, ['main', 'feature/una']);
  });

  test('a quoted branch name is read', () => {
    const { events } = parseTriggers('on:\n  push:\n    branches: ["main"]\n');
    assert.deepEqual(events.push.branches, ['main']);
  });

  test('comments and blank lines do not confuse the reader', () => {
    const { events, problems } = parseTriggers('# the gates\non:\n\n  # the trunk\n  push:\n    branches: [main] # and the other one\n');
    assert.deepEqual(events.push.branches, ['main']);
    assert.deepEqual(problems, []);
  });

  test('a workflow with no trigger key is reported', () => {
    const { problems } = parseTriggers('name: ci\njobs:\n  verify:\n    runs-on: ubuntu-latest\n');
    assert.ok(problems.some((p) => p.includes('never triggers')), `problemas: ${JSON.stringify(problems)}`);
  });
});

describe('the rules', () => {
  test('a trigger on a branch that exists passes', () => {
    assert.deepEqual(findingsFor([wf('ci.yml', 'on:\n  push:\n    branches: [main]\n')]), []);
  });

  test('a trigger on a branch that does not exist fails', () => {
    // This is the defect the gate exists to catch: the workflow named a
    // branch the repository did not have, so it never started and never
    // failed. A missing run and a passing run look the same from outside.
    const findings = findingsFor([wf('ci.yml', 'on:\n  push:\n    branches: [main, does-not-exist]\n')]);
    assert.equal(findings.length, 1);
    assert.match(findings[0], /does not exist in/);
  });

  test('a trigger that misses the trunk fails', () => {
    // The worse version of the same defect: the branch exists, the workflow
    // runs, it is green, and the state people merge into is still unverified.
    const findings = findingsFor([wf('ci.yml', 'on:\n  push:\n    branches: [feature/una]\n')]);
    assert.equal(findings.length, 1);
    assert.match(findings[0], /does not trigger on the trunk branch "main"/);
  });

  test('a pull request trigger without a filter passes', () => {
    assert.deepEqual(findingsFor([wf('ci.yml', 'on:\n  pull_request:\n')]), []);
  });

  test('a pull request trigger that misses the trunk fails', () => {
    const findings = findingsFor([wf('ci.yml', 'on:\n  pull_request:\n    branches: [feature/una]\n')]);
    assert.equal(findings.length, 1);
    assert.match(findings[0], /does not trigger on the trunk branch "main"/);
  });

  test('a branches-ignore that hides the trunk fails', () => {
    const findings = findingsFor([wf('ci.yml', 'on:\n  push:\n    branches-ignore: [main]\n')]);
    assert.equal(findings.length, 1);
    assert.match(findings[0], /ignores the trunk branch "main"/);
  });

  test('a pattern that matches a branch passes', () => {
    const findings = findingsFor([wf('ci.yml', 'on:\n  push:\n    branches: [main, "release/*"]\n')], {
      existing: [TRUNK, 'release/1.0'],
    });
    assert.deepEqual(findings, []);
  });

  test('a pattern that matches nothing fails', () => {
    const findings = findingsFor([wf('ci.yml', 'on:\n  push:\n    branches: [main, "release/*"]\n')]);
    assert.equal(findings.length, 1);
    assert.match(findings[0], /matches no branch in/);
  });

  test('a negated pattern is not required to exist', () => {
    assert.deepEqual(findingsFor([wf('ci.yml', 'on:\n  push:\n    branches: [main, "!does-not-exist"]\n')]), []);
  });
});

describe('the canary', () => {
  test('a repository where every workflow is filtered loses the canary', () => {
    // Without an unfiltered push, the check that catches a wrong branch filter
    // can be silenced by that very wrong branch filter.
    const findings = evaluate([wf('ci.yml', 'on:\n  push:\n    branches: [main]\n')], {
      existing: [TRUNK],
      trunk: TRUNK,
    });
    assert.equal(findings.length, 1);
    assert.match(findings[0], /triggers on every push/);
  });

  test('the canary workflow satisfies the canary rule on its own', () => {
    assert.deepEqual(evaluate([CANARY], { existing: [TRUNK], trunk: TRUNK }), []);
  });
});

describe('this repository', () => {
  test('its own workflows trigger on branches that exist, and cover the trunk', (t) => {
    const remote = pickRemote();
    const trunk = trunkBranch(remote);
    if (!trunk) {
      t.skip('this checkout has no remote to ask');
      return;
    }
    const findings = evaluate(readWorkflows(), { existing: existingBranches(remote), trunk });
    assert.deepEqual(findings, [], `workflows con un trigger que no cubre el tronco: ${findings.join(' | ')}`);
  });

  test('the trunk it asks about is the branch the remote points its HEAD at', (t) => {
    const remote = pickRemote();
    const trunk = trunkBranch(remote);
    if (!trunk) {
      t.skip('this checkout has no remote to ask');
      return;
    }
    // Not an assumption in the test: if the repository ever changes its trunk,
    // this assertion is what says so, instead of the gate quietly checking a
    // branch nobody merges into.
    assert.equal(trunk, TRUNK, `el tronco del remoto es "${trunk}", y este archivo está escrito para "${TRUNK}"`);
  });
});

/**
 * The repository with two remotes, built on the spot.
 *
 * `origin` has one branch, `main`. The second remote, `other`, is a different
 * repository, and it has `develop`. A gate that merges the two believes this
 * repository has a `develop` — a branch the server does not have — and stops
 * seeing the defect it exists to catch.
 */
function twoRemoteRepo() {
  const root = mkdtempSync(join(tmpdir(), 'workflow-branches-'));
  const git = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' });

  const makeRemote = (name, branch) => {
    const bare = join(root, `${name}.git`);
    git(['init', '--bare', bare], root);
    const work = join(root, `seed-${name}`);
    git(['init', work], root);
    git(['-c', 'user.email=gate@example.com', '-c', 'user.name=gate', 'commit', '--allow-empty', '-m', branch], work);
    git(['push', bare, `HEAD:refs/heads/${branch}`], work);
    return bare;
  };

  const origin = makeRemote('origin', 'main');
  const other = makeRemote('other', 'develop');

  const clone = join(root, 'clone');
  git(['clone', origin, clone], root);
  git(['remote', 'add', 'other', other], clone);
  // The second remote has to be fetched: a tracking ref is what the old
  // branch list read, and `git remote add` alone creates none.
  git(['fetch', 'other'], clone);

  return clone;
}

describe('the branch list', () => {
  test('a second remote does not lend its branches to this repository', () => {
    // A repository with a second remote, which is a different repository.
    // Its branches used to be merged into this repository's, and a branch
    // only the other repository has made the gate blind to the broken
    // trigger it exists to catch.
    const repo = twoRemoteRepo();
    const branches = existingBranches('origin', repo);
    assert.ok(branches.includes('main'), `ramas: ${branches.join(', ')}`);
    assert.ok(!branches.includes('develop'), `la rama del otro remoto se coló: ${branches.join(', ')}`);
  });
});
