import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, readdir, stat } from 'node:fs/promises';
import { dirname, join, normalize } from 'node:path';

const root = new URL('..', import.meta.url);
const expected = [
  '.github/dependabot.yml',
  '.github/workflows/ci.yml',
  '.gitignore',
  '.node-version',
  'AGENTS.md',
  'LICENSE',
  'README.md',
  'SECURITY.md',
  'compose.yaml',
  'docs/adr/0001-immutable-builds-and-frozen-route-snapshots.md',
  'docs/api.md',
  'docs/architecture.md',
  'docs/closed-book-contract.md',
  'docs/operations.md',
  'docs/requirements.md',
  'docs/research-log.md',
  'docs/threat-model.md',
  'docs/verification.md',
  'package-lock.json',
  'package.json',
  'scripts/infra-benchmark.mjs',
  'scripts/infra-smoke.mjs',
  'scripts/repo-check.mjs',
  'sql/schema.sql',
  'src/artifacts.js',
  'src/contracts.js',
  'src/crypto.js',
  'src/errors.js',
  'src/fixtures.js',
  'src/http.js',
  'src/index.js',
  'src/main.js',
  'src/object-store.js',
  'src/repository.js',
  'src/routing.js',
  'src/service.js',
  'test/integration/postgresql.test.js',
  'test/unit/contracts.test.js',
  'test/unit/http.test.js',
  'test/unit/object-store.test.js',
  'test/unit/routing.test.js',
];

async function walk(directory, prefix = '') {
  const paths = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue;
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) paths.push(...await walk(new URL(`${entry.name}/`, directory), relative));
    else paths.push(relative);
  }
  return paths;
}

for (const path of expected) {
  assert.equal((await stat(new URL(path, root))).isFile(), true, `missing required file: ${path}`);
}

const packageJson = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
assert.deepEqual(packageJson.dependencies, { pg: '8.23.0' });
assert.equal(packageJson.engines.node, '>=22');
for (const script of ['lint', 'test', 'test:infra', 'smoke:infra', 'benchmark:infra', 'audit', 'check', 'check:ci']) {
  assert.equal(typeof packageJson.scripts[script], 'string', `missing package script: ${script}`);
}
const lock = JSON.parse(await readFile(new URL('package-lock.json', root), 'utf8'));
assert.equal(lock.lockfileVersion, 3);
assert.deepEqual(lock.packages[''].dependencies, packageJson.dependencies);

const workflow = await readFile(new URL('.github/workflows/ci.yml', root), 'utf8');
assert.match(workflow, /node: \[22, 24, 26\]/);
assert.match(workflow, /postgis\/postgis:17-3\.5-alpine@sha256:[0-9a-f]{64}/);
assert.match(workflow, /permissions:\n  contents: read/);
const actionUses = [...workflow.matchAll(/uses: [^@\n]+@([^\s#]+)/g)].map((match) => match[1]);
assert.ok(actionUses.length >= 2);
assert.ok(actionUses.every((reference) => /^[0-9a-f]{40}$/.test(reference)), 'actions must use full commit pins');

const schema = await readFile(new URL('sql/schema.sql', root), 'utf8');
for (const contract of [
  "state IN ('deriving', 'complete', 'rejected')",
  "action IN ('publish', 'rollback')",
  "status IN ('accepted', 'complete')",
  "overlay_resolution IN ('current', 'base_fallback')",
  'UNIQUE (owner_fingerprint, request_key)',
]) assert.ok(schema.includes(contract), `missing schema contract: ${contract}`);

const repository = await readFile(new URL('src/repository.js', root), 'utf8');
for (const contract of [
  'pg_advisory_xact_lock',
  'FOR UPDATE OF state',
  'FOR SHARE OF state',
  "state = 'complete'",
  'current_overlay_id = NULL',
  "throw precondition('current state revision changed', revision)",
]) assert.ok(repository.includes(contract), `missing repository contract: ${contract}`);

const objectStore = await readFile(new URL('src/object-store.js', root), 'utf8');
for (const contract of ['handle.sync()', 'await link(temporary, target)', 'syncDirectory(directory)', 'constantTimeHexEqual']) {
  assert.ok(objectStore.includes(contract), `missing object-store contract: ${contract}`);
}
const routing = await readFile(new URL('src/routing.js', root), 'utf8');
for (const contract of ["outcome: 'work_limit'", "outcome: 'no_route'", "outcome: 'route_found'", 'exhaustiveShortestCost']) {
  assert.ok(routing.includes(contract), `missing routing contract: ${contract}`);
}

const research = await readFile(new URL('docs/research-log.md', root), 'utf8');
for (const pinned of [
  '9d8388721e7231442763ad37398b8d82224aa68f',
  'b06b1a75fb95f0c2867f3f7a0f401da3665ec41a',
  '1cba204f93a7196453a09b242daecebec486d31a',
]) assert.ok(research.includes(pinned), `research log is missing fixed source identity: ${pinned}`);

const http = await readFile(new URL('src/http.js', root), 'utf8');
const logBodies = [...http.matchAll(/safeLog\(logger, \{([\s\S]*?)\}\)/g)].map((match) => match[1]);
assert.ok(logBodies.length >= 6, 'expected explicit safe log sites');
for (const body of logBodies) {
  for (const forbiddenField of [
    'owner', 'token', 'fingerprint', 'requestKey', 'buildId', 'routeId', 'generation', 'digest',
    'sourceNodeId', 'targetNodeId', 'latitude', 'longitude', 'result.body', 'objectPath',
  ]) assert.equal(body.includes(forbiddenField), false, `ordinary log includes forbidden field: ${forbiddenField}`);
}

const files = await walk(root);
const portable = files.filter((path) => /\.(?:md|js|mjs|json|sql|ya?ml)$/.test(path));
const forbidden = [
  /\/Users\//,
  /\/private\/tmp\//,
  /file:\/\//,
  /ghp_[A-Za-z0-9]{20,}/,
  /github_pat_[A-Za-z0-9_]{20,}/,
  /AKIA[0-9A-Z]{16}/,
  new RegExp(['Co', 'Authored-By:'].join('-')),
];
for (const path of portable) {
  const contents = await readFile(new URL(path, root), 'utf8');
  for (const pattern of forbidden) assert.equal(pattern.test(contents), false, `${path} contains forbidden portable data`);
}

for (const path of files.filter((value) => value.endsWith('.md'))) {
  const contents = await readFile(new URL(path, root), 'utf8');
  for (const match of contents.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
    const target = match[1].split('#', 1)[0];
    if (!target || /^(?:https?:|mailto:)/.test(target)) continue;
    const resolved = normalize(join(dirname(path), decodeURIComponent(target)));
    assert.equal((await stat(new URL(resolved, root))).isFile(), true, `${path} has broken link: ${target}`);
  }
}

for (const path of files.filter((value) => /\.(?:js|mjs)$/.test(value))) {
  execFileSync(process.execPath, ['--check', path], { cwd: root, stdio: 'inherit' });
}
execFileSync('git', ['diff', '--check'], { cwd: root, stdio: 'inherit' });
process.stdout.write(`${JSON.stringify({
  evidence: 'repository_policy_check',
  files: files.length,
  logSitesChecked: logBodies.length,
  markdownLinksChecked: true,
  syntaxChecked: true,
})}\n`);
