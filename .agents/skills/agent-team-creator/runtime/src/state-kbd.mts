import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import type { KbdIdentity, ObjectValue, TeamState } from './types.mjs';
import { prepareCompletion, recordEvent } from './state-tasks.mjs';
import { integer, object, text, validateState } from './state-validation.mjs';

function execute(binary: string, argv: string[], cwd: string): { value: ObjectValue; stdout: string } {
  const result = spawnSync(binary, argv, {
    cwd, shell: false, encoding: 'utf8', timeout: 30_000, maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    throw new Error(`Canonical KBD command failed or has an uncertain outcome; local completion was not recorded. Re-read canonical status before retrying. ${result.error?.message ?? result.stderr.trim()}`);
  }
  let value: unknown;
  try { value = JSON.parse(result.stdout); }
  catch { throw new Error('Canonical CLI returned non-JSON output; completion is unconfirmed, re-read status before retrying'); }
  return { value: object(value, 'canonical CLI output'), stdout: result.stdout };
}

function verifyIdentity(state: ObjectValue, identity: KbdIdentity): ObjectValue {
  if (state.projectId !== identity.projectId || state.runId !== identity.runId) throw new Error('Canonical project/run identity does not match the linked task');
  if (integer(state.revision, 'canonical revision') === 0) throw new Error('Canonical run is not initialized');
  const phase = object(object(state.phases, 'canonical phases')[identity.phaseId], 'canonical phase');
  const change = object(object(phase.changes, 'canonical changes')[identity.changeId], 'canonical change');
  const task = object(object(change.tasks, 'canonical tasks')[identity.taskId], 'canonical task');
  if (phase.id !== identity.phaseId || change.id !== identity.changeId || task.id !== identity.taskId) throw new Error('Canonical phase/change/task identity mismatch');
  return task;
}

/**
 * Source contract: prometheus-cli main.rs KbdAction::Status / KbdTaskAction::Transition.
 *   <kbdCli> kbd --path <cwd> status --json
 *   <kbdCli> kbd --path <cwd> task transition --command-id <id>
 *       --phase <phase> --change <change> --id <task> --status complete --summary <text>
 *
 * Call only inside a state transaction. kbdCli is explicit because PATH may name
 * another product. No shell, hooks, service registration, or synthetic KBD events.
 * The CLI chooses its canonical frontier; it exposes no expected-run/revision
 * argument. Preflight + committed-response identity checks detect drift but cannot
 * provide a distributed transaction across KBD and this file. A crash after the
 * canonical commit requires retry/reconciliation; never roll back KBD history.
 */
export function completeKbdTask(state: TeamState, input: ObjectValue, cwd: string): void {
  validateState(state);
  const complete = prepareCompletion(state, input);
  if (!complete.kbd) throw new Error('Task has no canonical KBD identity; use ordinary task completion');
  const binary = text(input.kbdCli, 'kbdCli executable');
  const directory = resolve(cwd);
  const base = ['kbd', '--path', directory];
  const identity = complete.kbd;
  const before = execute(binary, [...base, 'status', '--json'], directory);
  const canonicalTask = verifyIdentity(before.value, identity);
  if (!['in_progress', 'complete'].includes(String(canonicalTask.status))) throw new Error(`Canonical task must be in_progress before completion; current status: ${String(canonicalTask.status)}`);
  const commandId = `agent-team-${createHash('sha256').update(JSON.stringify({
    team: state.team.id, task: complete.id, revision: complete.revision - 1, identity,
  })).digest('hex')}`;
  let receipt = before;
  let argv = [...base, 'status', '--json'];
  let mode = 'reconciled-existing-completion';
  if (canonicalTask.status !== 'complete') {
    argv = [...base, 'task', 'transition', '--command-id', commandId,
      '--phase', identity.phaseId, '--change', identity.changeId, '--id', identity.taskId,
      '--status', 'complete', '--summary', `Team ${state.team.id}, task ${complete.id}. Evidence: ${complete.evidence.join('; ')}`];
    const response = execute(binary, argv, directory);
    receipt = { value: object(response.value.state, 'committed canonical state'), stdout: response.stdout };
    mode = 'transition-committed';
  }
  const committed = verifyIdentity(receipt.value, identity);
  if (committed.status !== 'complete') throw new Error('Canonical response did not confirm completion; local task remains unchanged');
  const draft = structuredClone(state);
  draft.tasks[draft.tasks.findIndex(task => task.id === complete.id)] = complete;
  recordEvent(draft, 'kbd.task.completed', {
    taskId: complete.id, taskRevision: complete.revision, owner: complete.owner,
    kbd: { ...identity }, commandId, mode, executable: binary, argv,
    canonicalRevision: receipt.value.revision!, canonicalTaskStatus: committed.status,
    canonicalEventId: receipt.value.lastEventId ?? null,
    receiptSha256: createHash('sha256').update(receipt.stdout).digest('hex'),
    evidence: complete.evidence,
  });
  validateState(draft);
  Object.assign(state, draft);
}
