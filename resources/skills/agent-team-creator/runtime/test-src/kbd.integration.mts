import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fixture, team } from './fixture.mjs';

const binary = process.env.PROMETHEUS_CLI_TEST_BINARY;
const skip = !binary ? 'PROMETHEUS_CLI_TEST_BINARY is required: canonical KBD integration is unverified without the real CLI' : false;
type Fixture = ReturnType<typeof fixture>;
interface Identity { projectId: string; runId: string; phaseId: string; changeId: string; taskId: string }

function canonical(f: Fixture) {
  assert.ok(binary && path.isAbsolute(binary), 'PROMETHEUS_CLI_TEST_BINARY must name the actual absolute CLI path');
  const root = path.join(f.root, 'canonical-project');
  const data = path.join(f.root, 'canonical-data');
  // Discovery walks ancestors. Establish the boundary before the first CLI call.
  fs.mkdirSync(path.join(root, '.kbd-orchestrator'), { recursive: true });
  fs.mkdirSync(data, { recursive: true });
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const privateJwk = privateKey.export({ format: 'jwk' });
  const publicJwk = publicKey.export({ format: 'jwk' });
  assert.ok(privateJwk.d && publicJwk.x);
  const keyFile = path.join(f.root, 'canonical-device-key.json');
  fs.writeFileSync(keyFile, JSON.stringify({ schemaVersion: '1',
    keyId: `ed25519:${createHash('sha256').update(Buffer.from(publicJwk.x, 'base64url')).digest('hex')}`,
    privateKey: Buffer.from(privateJwk.d, 'base64url').toString('base64'),
  }), { mode: 0o600 });
  const env = { ...process.env, PROMETHEUS_DATA_DIR: data, PROMETHEUS_DEVICE_KEY_FILE: keyFile,
    PROMETHEUS_KBD_CONTROL_PLANE: '0', PROMETHEUS_CONTROL_ENDPOINT: 'http://127.0.0.1:1',
    PROMETHEUS_HARNESS: 'agent-team-integration', OPENSPEC_TELEMETRY: '0', DO_NOT_TRACK: '1' };
  const cli = (...args: string[]) => {
    const result = spawnSync(binary, ['kbd', '--path', root, ...args], {
      cwd: root, env, encoding: 'utf8', shell: false, timeout: 60_000, maxBuffer: 16 * 1024 * 1024,
    });
    assert.equal(result.error, undefined, result.error?.message);
    assert.equal(result.status, 0, `${args.join(' ')}\n${result.stderr}\n${result.stdout}`);
    return JSON.parse(result.stdout);
  };
  const initial = cli('status', '--json');
  assert.equal(initial.runtimeInitialized, false);
  assert.ok(initial.runtimePath.startsWith(data + path.sep), 'canonical storage must remain inside the fixture');
  const registry = cli('projects', '--json');
  const registered = Object.keys(registry.replicas);
  assert.equal(registered.length, 1, 'isolated registry must contain only the test checkout');
  assert.equal(fs.realpathSync(registered[0]), fs.realpathSync(root), 'discovery must stop at the fixture marker');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, '.prometheus', 'project.json'), 'utf8'));
  assert.equal(registry.replicas[registered[0]].projectId, manifest.projectId);
  cli('phase', 'create', '--command-id', 'team-phase-create', '--id', 'phase-id', '--slug', 'phase-slug', '--title', 'Team fixture phase');
  cli('phase', 'activate', '--command-id', 'team-phase-activate', '--id', 'phase-id');
  cli('change', 'register', '--command-id', 'team-change-register', '--phase', 'phase-id', '--id', 'change-id', '--title', 'Team fixture change');
  cli('task', 'register', '--command-id', 'team-task-register', '--phase', 'phase-id', '--change', 'change-id', '--id', 'task-id', '--title', 'Team fixture task');
  cli('task', 'transition', '--command-id', 'team-task-start', '--phase', 'phase-id', '--change', 'change-id', '--id', 'task-id', '--status', 'in-progress');
  const status = () => cli('status', '--json');
  const state = status();
  assert.equal(state.projectId, manifest.projectId);
  assert.equal(state.phases['phase-id'].changes['change-id'].tasks['task-id'].status, 'in_progress');
  const identity: Identity = { projectId: state.projectId, runId: state.runId, phaseId: 'phase-id', changeId: 'change-id', taskId: 'task-id' };
  return { root, data, env, cli, status, identity };
}

function linkedTask(f: Fixture, identity: Identity, id = 'linked') {
  f.call('task', { state: f.state, expectedRevision: f.read().revision,
    task: { action: 'add', id, title: 'Linked canonical work', owner: 'implementer', kbd: identity } });
  f.call('task', { state: f.state, expectedRevision: f.read().revision,
    task: { action: 'start', id, owner: 'implementer', expectedTaskRevision: 0 } });
}

function completionRequest(f: Fixture, root: string, id = 'linked') {
  const state = f.read(), task = state.tasks.find((item: { id: string }) => item.id === id);
  return { state: f.state, expectedRevision: state.revision, cwd: root,
    task: { id, owner: task.owner, expectedTaskRevision: task.revision,
      kbdCli: binary!, evidence: ['evidence/actual-result.md'], remaining: [] } };
}

test('packaged linked completion commits through the real canonical CLI and records its returned identity', { skip, timeout: 180_000 }, t => {
  const f = fixture(); t.after(f.close);
  const kbd = canonical(f);
  f.call('init', { state: f.state, team: team() });
  linkedTask(f, kbd.identity);
  fs.mkdirSync(path.join(kbd.root, 'evidence'), { recursive: true });
  fs.writeFileSync(path.join(kbd.root, 'evidence', 'actual-result.md'), 'Integration evidence: the real canonical CLI confirms this task transition.\n');
  const before = kbd.status();
  const localBefore = fs.readFileSync(f.state);
  const request = completionRequest(f, kbd.root);
  assert.match(f.call('task', { state: f.state, expectedRevision: request.expectedRevision,
    task: { ...request.task, action: 'complete' } }, 1, kbd.env).error, /canonical CLI receipt/);
  assert.deepEqual(fs.readFileSync(f.state), localBefore);
  assert.equal(kbd.status().revision, before.revision, 'ordinary local completion cannot change canonical work');
  const local = f.call('complete-kbd', request, 0, kbd.env);
  const after = kbd.status();
  const nativeTask = after.phases['phase-id'].changes['change-id'].tasks['task-id'];
  assert.equal(nativeTask.status, 'complete');
  assert.match(nativeTask.summary, /evidence\/actual-result\.md/);
  assert.ok(after.revision > before.revision);
  assert.equal(local.tasks[0].status, 'complete');
  assert.equal(local.tasks[0].revision, 2);
  const receipt = local.events.at(-1);
  assert.equal(receipt.kind, 'kbd.task.completed');
  assert.equal(receipt.detail.mode, 'transition-committed');
  assert.deepEqual(receipt.detail.kbd, kbd.identity);
  assert.equal(receipt.detail.canonicalRevision, after.revision);
  assert.equal(receipt.detail.canonicalEventId, after.lastEventId);
  assert.equal(receipt.detail.canonicalTaskStatus, 'complete');
  assert.equal(after.commandRevisions[receipt.detail.commandId], after.revision);
  assert.match(receipt.detail.receiptSha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(receipt.detail.argv.slice(0, 5), ['kbd', '--path', kbd.root, 'task', 'transition']);
  assert.equal(local.events.some((event: { kind: string }) => /boundary|karpathy/.test(event.kind)), false);
  const committed = fs.readFileSync(f.state);
  const retry = completionRequest(f, kbd.root);
  assert.match(f.call('complete-kbd', retry, 1, kbd.env).error, /terminal/);
  assert.deepEqual(fs.readFileSync(f.state), committed);
  assert.equal(kbd.status().revision, after.revision);
});

test('each wrong canonical identity is rejected without canonical or local completion', { skip, timeout: 180_000 }, t => {
  const f = fixture(); t.after(f.close);
  const kbd = canonical(f);
  f.call('init', { state: f.state, team: team() });
  for (const field of ['projectId', 'runId', 'phaseId', 'changeId', 'taskId'] as const) {
    const id = `wrong-${field.toLowerCase()}`;
    linkedTask(f, { ...kbd.identity, [field]: `wrong-${field}` }, id);
    const before = kbd.status(), local = fs.readFileSync(f.state);
    const failure = f.call('complete-kbd', completionRequest(f, kbd.root, id), 1, kbd.env);
    assert.match(failure.error, /canonical|identity/i);
    assert.deepEqual(fs.readFileSync(f.state), local);
    const after = kbd.status();
    assert.equal(after.revision, before.revision);
    assert.equal(after.phases['phase-id'].changes['change-id'].tasks['task-id'].status, 'in_progress');
    assert.equal(fs.existsSync(`${f.state}.lock`), false);
  }
  assert.equal(f.read().events.some((event: { kind: string }) => event.kind === 'kbd.task.completed'), false);
});

test('a real prior canonical completion reconciles local state without submitting another transition', { skip, timeout: 180_000 }, t => {
  const f = fixture(); t.after(f.close);
  const kbd = canonical(f);
  f.call('init', { state: f.state, team: team() });
  linkedTask(f, kbd.identity);
  kbd.cli('task', 'transition', '--command-id', 'complete-before-local-receipt', '--phase', 'phase-id',
    '--change', 'change-id', '--id', 'task-id', '--status', 'complete', '--summary', 'Canonical completion occurred before local receipt');
  const before = kbd.status();
  const local = f.call('complete-kbd', completionRequest(f, kbd.root), 0, kbd.env);
  const after = kbd.status();
  assert.equal(after.revision, before.revision);
  assert.equal(after.lastEventId, before.lastEventId);
  assert.equal(local.tasks[0].status, 'complete');
  const receipt = local.events.at(-1).detail;
  assert.equal(receipt.mode, 'reconciled-existing-completion');
  assert.deepEqual(receipt.argv, ['kbd', '--path', kbd.root, 'status', '--json']);
  assert.deepEqual(receipt.kbd, kbd.identity);
  assert.equal(receipt.canonicalRevision, before.revision);
  assert.equal(after.commandRevisions[receipt.commandId], undefined, 'reconciliation must not invent a canonical command');
});
