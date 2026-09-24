import { harnesses, type Harness, type ObjectValue, type TeamState } from './types.mjs';
import { validateTeam } from './validation.mjs';

export function object(value: unknown, label: string): ObjectValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as ObjectValue;
}

export function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0')) throw new Error(`${label} must be a nonempty string without NUL`);
  return value;
}

export function integer(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error(`${label} must be a nonnegative safe integer`);
  return value;
}

export function strings(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value.map((item, index) => text(item, `${label}[${index}]`));
}

export function harness(value: unknown): Harness {
  if (typeof value !== 'string' || !harnesses.includes(value as Harness)) throw new Error(`Unsupported harness: ${String(value)}`);
  return value as Harness;
}

export function owner(state: TeamState, value: unknown): string {
  const id = text(value, 'owner');
  if (!state.team.roles.some(role => role.id === id)) throw new Error(`Unknown team role: ${id}`);
  return id;
}

function timestamp(value: unknown, label: string): void {
  if (!Number.isFinite(Date.parse(text(value, label)))) throw new Error(`${label} must be an ISO timestamp`);
}

function uniqueIds(items: unknown, label: string): ObjectValue[] {
  if (!Array.isArray(items)) throw new Error(`${label} must be an array`);
  const ids = new Set<string>();
  return items.map(item => {
    const entry = object(item, label);
    const id = text(entry.id, `${label}.id`);
    if (ids.has(id)) throw new Error(`Duplicate ${label} id: ${id}`);
    ids.add(id);
    return entry;
  });
}

function jsonBoundary(value: unknown, ancestors = new Set<object>()): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (!value || typeof value !== 'object') throw new Error('State must contain only JSON values');
  if (ancestors.has(value)) throw new Error('State contains a cyclic object');
  if (!Array.isArray(value) && ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error('State objects must be plain JSON objects');
  ancestors.add(value);
  for (const item of Array.isArray(value) ? value : Object.values(value)) jsonBoundary(item, ancestors);
  ancestors.delete(value);
}

export function validateState(value: unknown): TeamState {
  jsonBoundary(value);
  const raw = object(value, 'state');
  if (raw.schemaVersion !== 1) throw new Error('Unsupported state schemaVersion');
  integer(raw.revision, 'state.revision');
  validateTeam(raw.team);
  const state = value as TeamState;
  const tasks = uniqueIds(raw.tasks, 'task');
  const byId = new Map(tasks.map(task => [task.id, task]));
  for (const task of tasks) {
    text(task.title, 'task.title');
    owner(state, task.owner);
    harness(task.harness);
    integer(task.revision, 'task.revision');
    if (!['pending', 'running', 'blocked', 'complete', 'cancelled'].includes(String(task.status))) throw new Error(`Invalid task status: ${String(task.status)}`);
    const dependencies = strings(task.dependsOn, 'task.dependsOn');
    if (new Set(dependencies).size !== dependencies.length) throw new Error('Duplicate task dependency');
    for (const dependency of dependencies) {
      if (dependency === task.id || !byId.has(dependency)) throw new Error(`Invalid task dependency: ${dependency}`);
      if (['running', 'complete'].includes(String(task.status)) && byId.get(dependency)!.status !== 'complete') throw new Error(`Dependency ${dependency} is not complete`);
    }
    const evidence = strings(task.evidence, 'task.evidence');
    const remaining = strings(task.remaining, 'task.remaining');
    if (task.status === 'complete' && (!evidence.length || remaining.length)) throw new Error('Completed tasks require evidence and no remaining work');
    if (task.kbd !== undefined) {
      const kbd = object(task.kbd, 'task.kbd');
      for (const field of ['projectId', 'runId', 'phaseId', 'changeId', 'taskId']) text(kbd[field], `task.kbd.${field}`);
    }
    if (task.modelPolicy !== undefined) {
      // Reuse the manifest's policy boundary without inventing another schema.
      validateTeam({ ...state.team, modelPolicy: task.modelPolicy });
    }
  }
  const visited = new Set<string>();
  const visiting = new Set<string>();
  function visit(id: string): void {
    if (visiting.has(id)) throw new Error(`Task dependency cycle at ${id}`);
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of byId.get(id)!.dependsOn as string[]) visit(dependency);
    visiting.delete(id);
    visited.add(id);
  }
  for (const task of state.tasks) visit(task.id);
  for (const handoff of uniqueIds(raw.handoffs, 'handoff')) {
    if (handoff.schemaVersion !== 1) throw new Error('Unsupported handoff schemaVersion');
    const taskId = text(handoff.taskId, 'handoff.taskId');
    if (!byId.has(taskId)) throw new Error(`Unknown handoff task: ${taskId}`);
    const revision = integer(handoff.taskRevision, 'handoff.taskRevision');
    if (revision > (byId.get(taskId)!.revision as number)) throw new Error('Handoff references a future task revision');
    for (const field of ['from', 'to']) {
      const endpoint = object(handoff[field], `handoff.${field}`);
      owner(state, endpoint.owner);
      harness(endpoint.harness);
    }
    text(handoff.context, 'handoff.context');
    text(handoff.prompt, 'handoff.prompt');
    for (const field of ['evidence', 'remaining', 'memoryRefs']) strings(handoff[field], `handoff.${field}`);
    const git = object(handoff.git, 'handoff.git');
    text(git.root, 'handoff.git.root');
    for (const field of ['head', 'branch']) if (git[field] !== null) text(git[field], `handoff.git.${field}`);
    if (git.dirty !== null && typeof git.dirty !== 'boolean') throw new Error('handoff.git.dirty must be boolean or null');
    timestamp(handoff.createdAt, 'handoff.createdAt');
    if (handoff.acceptedAt !== undefined) timestamp(handoff.acceptedAt, 'handoff.acceptedAt');
  }
  for (const memory of uniqueIds(raw.outbox, 'memory')) {
    text(memory.content, 'memory.content');
    text(memory.scope, 'memory.scope');
    object(memory.provenance, 'memory.provenance');
    if (!['queued', 'published'].includes(String(memory.status))) throw new Error('Invalid memory status');
    if (memory.status === 'published' && memory.receipt === undefined) throw new Error('Published memory requires a receipt');
  }
  for (const event of uniqueIds(raw.events, 'event')) {
    timestamp(event.at, 'event.at');
    text(event.kind, 'event.kind');
    object(event.detail, 'event.detail');
  }
  return state;
}

export function validateMutation(before: TeamState, after: TeamState): void {
  if (after.revision !== before.revision || after.team.id !== before.team.id) throw new Error('Callback may not change state revision or team identity');
  validateState(after);
  const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
  if (!same(before.events, after.events.slice(0, before.events.length))) throw new Error('Event history is append-only');
  for (const old of before.tasks) {
    const next = after.tasks.find(task => task.id === old.id);
    if (!next) throw new Error('Tasks cannot be deleted; cancel instead');
    if (same(old, next)) continue;
    if (['complete', 'cancelled'].includes(old.status)) throw new Error(`Task ${old.id} is terminal`);
    if (next.revision !== old.revision + 1) throw new Error('Each changed task must increment its revision once');
    if (!same(old.kbd, next.kbd)) throw new Error('Canonical task identity cannot be reassigned');
    const ownershipChanged = old.owner !== next.owner || old.harness !== next.harness;
    const allowed = old.status === 'pending'
      ? ['pending', 'running', 'blocked', 'cancelled']
      : old.status === 'running'
        ? ['running', 'blocked', 'complete', 'cancelled', ...(ownershipChanged ? ['pending'] : [])]
        : ['blocked', 'running', 'cancelled'];
    if (!allowed.includes(next.status)) throw new Error(`Invalid task transition: ${old.status} -> ${next.status}`);
    if (old.kbd && next.status === 'complete') {
      const receipt = after.events.slice(before.events.length).find(event => event.kind === 'kbd.task.completed' && event.detail.taskId === next.id && event.detail.taskRevision === next.revision);
      if (!receipt || !same(receipt.detail.kbd, next.kbd) || receipt.detail.canonicalTaskStatus !== 'complete') throw new Error('Linked task completion requires a canonical completion receipt');
    }
  }
  for (const task of after.tasks) if (!before.tasks.some(old => old.id === task.id) && task.revision !== 0) throw new Error('New tasks start at revision 0');
  for (const old of before.handoffs) {
    const next = after.handoffs.find(handoff => handoff.id === old.id);
    if (!next || !same({ ...old, acceptedAt: undefined }, { ...next, acceptedAt: undefined }) || (old.acceptedAt !== undefined && next.acceptedAt !== old.acceptedAt)) throw new Error('Handoff packets and accepted receipts are immutable');
  }
}
