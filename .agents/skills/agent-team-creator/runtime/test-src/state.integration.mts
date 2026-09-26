import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fixture, team } from './fixture.mjs';

type Fixture = ReturnType<typeof fixture>;
type Fields = Record<string, unknown>;
const bytes = (f: Fixture) => fs.readFileSync(f.state);

function add(f: Fixture, id: string, extra: Fields = {}) {
  return f.call('task', { state: f.state, expectedRevision: f.read().revision,
    task: { action: 'add', id, title: `Deliver ${id}`, owner: 'implementer', ...extra } });
}

function update(f: Fixture, id: string, action: string, extra: Fields = {}) {
  const state = f.read(), task = state.tasks.find((item: { id: string }) => item.id === id);
  assert.ok(task);
  return f.call('task', { state: f.state, expectedRevision: state.revision,
    task: { action, id, owner: task.owner, expectedTaskRevision: task.revision, ...extra } });
}

function refused(f: Fixture, command: string, input: Fields, reason: RegExp) {
  const before = bytes(f);
  const failure = f.call(command, input, 1);
  assert.match(failure.error, reason);
  assert.deepEqual(bytes(f), before, 'rejected CLI command must preserve exact state bytes');
  assert.equal(fs.existsSync(`${f.state}.lock`), false, 'failed command must release its own lock');
}

function handoff(f: Fixture, taskId: string, cwd: string) {
  const state = f.read(), task = state.tasks.find((item: { id: string }) => item.id === taskId);
  const next = f.call('handoff-create', { state: f.state, expectedRevision: state.revision, cwd,
    handoff: { taskId, owner: task.owner, expectedTaskRevision: task.revision,
      toOwner: 'reviewer', toHarness: 'claude', context: 'Review the actual patch and finish the task.',
      evidence: ['evidence.md'], remaining: ['Review the patch'], memoryRefs: ['memory/decision.md'] } });
  return next.handoffs.at(-1);
}

test('packaged CLI preserves owner/revision boundaries through dependencies, blocking, reassignment and completion', t => {
  const f = fixture(); t.after(f.close);
  assert.equal(f.call('init', { state: f.state, team: team() }).revision, 0);
  add(f, 'implementation');
  add(f, 'verification', { owner: 'reviewer', dependsOn: ['implementation'] });
  const initial = f.read();
  refused(f, 'task', { state: f.state, expectedRevision: initial.revision,
    task: { action: 'start', id: 'verification', owner: 'reviewer', expectedTaskRevision: 0 } }, /Dependency implementation is not complete/);
  refused(f, 'task', { state: f.state, expectedRevision: initial.revision,
    task: { action: 'start', id: 'implementation', owner: 'reviewer', expectedTaskRevision: 0 } }, /belongs to implementer/);
  refused(f, 'task', { state: f.state, expectedRevision: initial.revision,
    task: { action: 'start', id: 'implementation', owner: 'implementer' } }, /expectedTaskRevision/);
  update(f, 'implementation', 'start');
  refused(f, 'task', { state: f.state, expectedRevision: initial.revision,
    task: { action: 'block', id: 'implementation', owner: 'implementer', expectedTaskRevision: 1, reason: 'Stale writer' } }, /State revision conflict/);
  refused(f, 'task', { state: f.state, expectedRevision: f.read().revision,
    task: { action: 'block', id: 'implementation', owner: 'implementer', expectedTaskRevision: 0, reason: 'Stale task' } }, /Task revision conflict/);
  let state = update(f, 'implementation', 'block', { reason: 'Need a decision', evidence: ['discussion.md'] });
  assert.equal(state.tasks[0].status, 'blocked');
  assert.deepEqual(state.tasks[0].remaining, ['Need a decision']);
  update(f, 'implementation', 'start');
  refused(f, 'task', { state: f.state, expectedRevision: f.read().revision,
    task: { action: 'complete', id: 'implementation', owner: 'implementer', expectedTaskRevision: 3, evidence: ['proof.md'] } }, /no remaining work/);
  state = update(f, 'implementation', 'reassign', { toOwner: 'reviewer', toHarness: 'claude' });
  assert.equal(state.tasks[0].status, 'pending');
  assert.equal(state.tasks[0].owner, 'reviewer');
  assert.equal(state.tasks[0].harness, 'claude');
  assert.equal(state.tasks[0].revision, 4);
  refused(f, 'task', { state: f.state, expectedRevision: state.revision,
    task: { action: 'start', id: 'implementation', owner: 'implementer', expectedTaskRevision: 4 } }, /belongs to reviewer/);
  update(f, 'implementation', 'start', { remaining: [] });
  state = update(f, 'implementation', 'complete', { evidence: ['proof.md'], remaining: [] });
  assert.equal(state.tasks[0].revision, 6);
  assert.equal(state.tasks[0].status, 'complete');
  assert.deepEqual(state.tasks[0].evidence, ['discussion.md', 'proof.md']);
  refused(f, 'task', { state: f.state, expectedRevision: state.revision,
    task: { action: 'reassign', id: 'implementation', owner: 'reviewer', expectedTaskRevision: 6, toOwner: 'implementer' } }, /terminal/);
  update(f, 'verification', 'start');
  refused(f, 'task', { state: f.state, expectedRevision: f.read().revision,
    task: { action: 'complete', id: 'verification', owner: 'reviewer', expectedTaskRevision: 1, evidence: [], remaining: [] } }, /requires evidence/);
  state = update(f, 'verification', 'complete', { evidence: ['review.md'], remaining: [] });
  assert.equal(state.tasks[1].status, 'complete');
  assert.equal(state.events.length, state.revision);
  assert.deepEqual(f.call('status', { state: f.state }), state, 'a new CLI process reads committed state');
});

test('cancelled dependencies stay unsatisfied and invalid additions never persist', t => {
  const f = fixture(); t.after(f.close);
  f.call('init', { state: f.state, team: team() });
  for (const extra of [{ dependsOn: ['missing'] }, { dependsOn: ['invalid'] }, { owner: 'absent' }, { harness: 'bossfang' }]) {
    refused(f, 'task', { state: f.state, expectedRevision: 0,
      task: { action: 'add', id: 'invalid', title: 'Invalid task', owner: 'implementer', ...extra } }, /dependency|role|harness/i);
  }
  add(f, 'parent');
  add(f, 'child', { dependsOn: ['parent'] });
  update(f, 'parent', 'cancel', { reason: 'Withdrawn scope' });
  const state = f.read();
  assert.equal(state.tasks[0].status, 'cancelled');
  assert.equal(state.events.at(-1).detail.reason, 'Withdrawn scope');
  refused(f, 'task', { state: f.state, expectedRevision: state.revision,
    task: { action: 'start', id: 'parent', owner: 'implementer', expectedTaskRevision: 1 } }, /terminal/);
  refused(f, 'task', { state: f.state, expectedRevision: state.revision,
    task: { action: 'start', id: 'child', owner: 'implementer', expectedTaskRevision: 0 } }, /Dependency parent is not complete/);
  // Malformed persisted input crosses the real CLI read boundary, not a module seam.
  const original = bytes(f);
  state.tasks[0].dependsOn = ['child'];
  fs.writeFileSync(f.state, JSON.stringify(state));
  const invalid = bytes(f);
  assert.match(f.call('status', { state: f.state }, 1).error, /dependency cycle/i);
  assert.deepEqual(bytes(f), invalid);
  fs.writeFileSync(f.state, original);
  assert.equal(f.call('status', { state: f.state }).tasks[0].status, 'cancelled');
});

test('simultaneous packaged writers have one winner and preserve the other task on revision-aware retry', async t => {
  const f = fixture(); t.after(f.close);
  f.call('init', { state: f.state, team: team() });
  const request = (id: string, revision: number) => ({ state: f.state, expectedRevision: revision,
    task: { action: 'add', id, title: id, owner: 'implementer' } });
  const results = await Promise.all(['first', 'second'].map(id => f.concurrent('task', request(id, 0))));
  assert.deepEqual(results.map(result => result.status).sort(), [0, 1]);
  const rejected = results.find(result => result.status === 1)!;
  assert.match(JSON.parse(rejected.stderr).error, /lock held|revision conflict/i);
  const winner = f.read();
  assert.equal(winner.revision, 1);
  assert.equal(winner.tasks.length, 1);
  assert.equal(winner.events.length, 1);
  const missing = winner.tasks[0].id === 'first' ? 'second' : 'first';
  const final = f.call('task', request(missing, winner.revision));
  assert.equal(final.revision, 2);
  assert.deepEqual(final.tasks.map((task: { id: string }) => task.id).sort(), ['first', 'second']);
  assert.equal(fs.existsSync(`${f.state}.lock`), false);
  assert.equal(fs.readdirSync(f.root).some(file => file.endsWith('.tmp')), false);
});

test('an existing real filesystem lock is never stolen and team replacement preserves history references', t => {
  const f = fixture(); t.after(f.close);
  f.call('init', { state: f.state, team: team() });
  const lock = `${f.state}.lock`, content = JSON.stringify({ pid: process.pid, at: '2000-01-01T00:00:00Z', token: 'held-by-integration' });
  fs.writeFileSync(lock, content, { flag: 'wx' });
  const before = bytes(f);
  assert.match(f.call('task', { state: f.state, expectedRevision: 0,
    task: { action: 'add', id: 'blocked', title: 'Blocked writer', owner: 'implementer' } }, 1).error, /lock held/i);
  assert.equal(fs.readFileSync(lock, 'utf8'), content);
  assert.deepEqual(bytes(f), before);
  fs.rmSync(lock);
  add(f, 'retained');
  handoff(f, 'retained', path.join(f.root, 'missing-directory'));
  const replacement = team(); replacement.outcome = 'Revised explicit outcome';
  f.call('team-update', { state: f.state, expectedRevision: f.read().revision, team: replacement });
  const removed = { ...replacement, roles: replacement.roles.filter(role => role.id !== 'reviewer') };
  refused(f, 'team-update', { state: f.state, expectedRevision: f.read().revision, team: removed }, /Unknown team role: reviewer/);
});

test('handoff snapshots real clean/dirty Git and transfers only on targeted revision-safe acceptance', t => {
  const f = fixture(); t.after(f.close);
  const project = path.join(f.root, 'git-project'); fs.mkdirSync(project);
  const emptyConfig = path.join(f.root, 'empty-git-config'); fs.writeFileSync(emptyConfig, '');
  const env = { ...process.env, GIT_CONFIG_GLOBAL: emptyConfig, GIT_CONFIG_NOSYSTEM: '1' };
  const git = (...args: string[]) => {
    const result = spawnSync('git', ['-C', project, ...args], { env, encoding: 'utf8', shell: false, timeout: 15_000 });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  git('init'); git('symbolic-ref', 'HEAD', 'refs/heads/handoff-integration');
  git('config', 'user.name', 'Integration Fixture'); git('config', 'user.email', 'fixture@example.invalid');
  fs.writeFileSync(path.join(project, 'evidence.md'), 'Initial evidence\n');
  git('add', 'evidence.md'); git('commit', '-m', 'Initial fixture evidence');
  const head = git('rev-parse', 'HEAD');
  f.call('init', { state: f.state, team: team() });
  add(f, 'transfer', { evidence: ['prior-evidence.md'], remaining: ['Keep the original blocker'] });
  update(f, 'transfer', 'start');
  const clean = handoff(f, 'transfer', project);
  assert.equal(clean.git.dirty, false);
  fs.appendFileSync(path.join(project, 'evidence.md'), 'Uncommitted evidence\n');
  const packet = handoff(f, 'transfer', project);
  assert.equal(packet.git.head, head);
  assert.equal(packet.git.branch, 'handoff-integration');
  assert.equal(fs.realpathSync(packet.git.root), fs.realpathSync(project));
  assert.equal(packet.git.dirty, true);
  assert.equal(packet.taskRevision, 1);
  assert.deepEqual(packet.from, { owner: 'implementer', harness: 'codex' });
  assert.deepEqual(packet.to, { owner: 'reviewer', harness: 'claude' });
  assert.deepEqual(packet.evidence, ['prior-evidence.md', 'evidence.md']);
  assert.deepEqual(packet.remaining, ['Keep the original blocker', 'Review the patch']);
  assert.deepEqual(packet.memoryRefs, ['memory/decision.md']);
  assert.match(packet.prompt, /permissions do not transfer/);
  assert.equal(f.read().tasks[0].owner, 'implementer');
  assert.equal(f.read().tasks[0].revision, 1);
  const request = { state: f.state, expectedRevision: f.read().revision, id: packet.id,
    destination: { owner: 'reviewer', harness: 'claude' } };
  refused(f, 'handoff-accept', { ...request, destination: { owner: 'reviewer', harness: 'codex' } }, /targeted destination/);
  const accepted = f.call('handoff-accept', request);
  assert.equal(accepted.tasks[0].owner, 'reviewer');
  assert.equal(accepted.tasks[0].harness, 'claude');
  assert.equal(accepted.tasks[0].status, 'pending');
  assert.equal(accepted.tasks[0].revision, 2);
  const receipt = accepted.handoffs.find((entry: { id: string }) => entry.id === packet.id);
  assert.ok(Number.isFinite(Date.parse(receipt.acceptedAt)));
  assert.deepEqual({ ...receipt, acceptedAt: undefined }, { ...packet, acceptedAt: undefined });
  const acceptedBytes = bytes(f);
  f.call('handoff-accept', { ...request, expectedRevision: accepted.revision });
  assert.deepEqual(bytes(f), acceptedBytes, 'same accepted receipt must be byte-idempotent');
  refused(f, 'handoff-accept', request, /State revision conflict/);
  refused(f, 'handoff-accept', { ...request, expectedRevision: accepted.revision, id: clean.id }, /belongs to reviewer|revision conflict/);
  update(f, 'transfer', 'start');
  refused(f, 'handoff-accept', { ...request, expectedRevision: f.read().revision }, /stale/);
});

test('unknown Git stays explicit and changed, reassigned or cancelled work rejects pending handoffs', t => {
  const f = fixture(); t.after(f.close);
  f.call('init', { state: f.state, team: team() });
  for (const action of ['start', 'reassign', 'cancel']) {
    add(f, action);
    const missing = path.join(f.root, 'no-such-git-directory');
    const packet = handoff(f, action, missing);
    assert.deepEqual(packet.git, { root: missing, head: null, branch: null, dirty: null });
    assert.match(packet.prompt, /dirty: unknown/);
    update(f, action, action, action === 'reassign' ? { toOwner: 'reviewer' } : action === 'cancel' ? { reason: 'Withdrawn' } : {});
    refused(f, 'handoff-accept', { state: f.state, expectedRevision: f.read().revision, id: packet.id,
      destination: { owner: 'reviewer', harness: 'claude' } }, /revision conflict|belongs to reviewer|terminal/);
    assert.equal(f.read().handoffs.find((entry: { id: string }) => entry.id === packet.id).acceptedAt, undefined);
  }
});
