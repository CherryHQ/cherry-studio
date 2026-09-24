import { createHash } from 'node:crypto';
import type { Json, MemoryEntry, ObjectValue, TeamState } from './types.mjs';
import { assertNoCredentials, endpoint, object, requestJson, RequestFailure, text } from './models-http.mjs';

function canonical(value: Json): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
const digest = (value: Json): string => createHash('sha256').update(canonical(value)).digest('hex');

function reference(state: TeamState, provenance: ObjectValue): void {
  if (provenance.kbd === undefined) return;
  const kbd = object(provenance.kbd, 'provenance.kbd');
  for (const key of ['projectId', 'runId', 'phaseId', 'changeId', 'taskId']) text(kbd[key], `kbd.${key}`);
  const matching = state.tasks.some(task => task.kbd && canonical(task.kbd as unknown as ObjectValue) === canonical(kbd));
  if (!matching) throw new Error('KBD provenance must exactly reference a linked team task; canonical validation is separate');
}

/** Caller commits this mutation atomically before offering the entry for publication. */
export function queueMemory(state: TeamState, input: ObjectValue): MemoryEntry {
  assertNoCredentials(input);
  const content = text(input.content, 'memory.content');
  const scope = text(input.scope, 'memory.scope');
  const supplied = input.provenance === undefined ? {} : object(input.provenance, 'memory.provenance');
  reference(state, supplied);
  const provenance: ObjectValue = { ...supplied, teamId: state.team.id, source: 'agent-team-runtime', authority: 'local-team-record; KBD references are unverified mirrors' };
  const identity = digest({ content, scope, provenance });
  const id = input.id === undefined ? `memory-${identity.slice(0, 48)}` : text(input.id, 'memory.id');
  if (!/^[a-z][a-z0-9-]{0,62}$/.test(id)) throw new Error('memory.id must be a portable lowercase identifier');
  const existing = state.outbox.find(entry => entry.id === id);
  if (existing) {
    if (digest({ content: existing.content, scope: existing.scope, provenance: existing.provenance }) !== identity) throw new Error('memory id conflicts with different content, scope or provenance');
    return existing;
  }
  const entry: MemoryEntry = { id, content, scope, provenance, status: 'queued' };
  state.outbox.push(entry);
  return entry;
}

interface Publication {
  body: ObjectValue;
  headers: Record<string, string>;
  remoteIdField: string;
  method: string;
  contract: ObjectValue;
}

function field(value: unknown, label: string): string {
  const key = text(value, label);
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || ['__proto__', 'prototype', 'constructor'].includes(key)) throw new Error('mapping fields must be safe top-level JSON property names');
  return key;
}

function publication(entry: MemoryEntry, input: ObjectValue): Publication {
  if (input.provider === 'surreal-memory') {
    const scope = object(input.scopeMapping, 'scopeMapping');
    if (scope.scope !== entry.scope) throw new Error('scopeMapping.scope must match the queued scope exactly');
    const agentId = text(scope.agentId, 'scopeMapping.agentId');
    const userId = scope.userId === undefined ? null : text(scope.userId, 'scopeMapping.userId');
    const sessionId = scope.sessionId === undefined ? null : text(scope.sessionId, 'scopeMapping.sessionId');
    // The verified REST request has no metadata or idempotency fields. Keep the
    // publication envelope inside content rather than inventing accepted fields.
    const content = JSON.stringify({ schemaVersion: 1, kind: 'agent-team-memory', id: entry.id, scope: entry.scope, provenance: entry.provenance, content: entry.content });
    return {
      body: { content, agent_id: agentId, user_id: userId, session_id: sessionId, categories: ['agent-team', entry.scope] },
      headers: {}, remoteIdField: 'id', method: 'POST',
      contract: { provider: 'surreal-memory', source: 'https://github.com/Prometheus-AGS/surreal-memory-server/blob/dd7fdcd6d8974af4059d1d51401bd33ae29f65db/src/contracts.rs',
        route: 'POST /api/v1/memory/', scopeBinding: 'explicit identity filters and content envelope; not an authorization guarantee', remoteIdempotency: 'unsupported-by-verified-contract' },
    };
  }
  if (input.provider !== 'mapped-http') throw new Error('memory provider must be surreal-memory or mapped-http');
  const mapping = object(input.mapping, 'mapping');
  const source = text(mapping.source, 'mapping.source');
  const version = text(mapping.version, 'mapping.version');
  const method = mapping.method ?? 'POST';
  if (method !== 'POST' && method !== 'PUT') throw new Error('mapping.method must be POST or PUT');
  const body: ObjectValue = mapping.constants === undefined ? {} : { ...object(mapping.constants, 'mapping.constants') };
  const fields: [string, Json][] = [
    [field(mapping.contentField, 'mapping.contentField'), entry.content],
    [field(mapping.scopeField, 'mapping.scopeField'), entry.scope],
    [field(mapping.provenanceField, 'mapping.provenanceField'), entry.provenance],
  ];
  if (mapping.idempotencyField !== undefined) fields.push([field(mapping.idempotencyField, 'mapping.idempotencyField'), entry.id]);
  const seen = new Set<string>();
  for (const [key, value] of fields) {
    if (seen.has(key) || Object.hasOwn(body, key)) throw new Error('memory mapping fields collide');
    seen.add(key); body[key] = value;
  }
  const headers: Record<string, string> = {};
  if (mapping.idempotencyHeader !== undefined) {
    const header = text(mapping.idempotencyHeader, 'mapping.idempotencyHeader');
    if (!/^(?:Idempotency-Key|X-Idempotency-Key)$/i.test(header)) throw new Error('unsupported idempotency header mapping');
    headers[header] = entry.id;
  }
  return { body, headers, method, remoteIdField: field(mapping.responseIdField, 'mapping.responseIdField'),
    contract: { provider: 'mapped-http', source, version, scopeBinding: 'operator-configured mapping; server authorization unverified',
      remoteIdempotency: mapping.idempotencyHeader || mapping.idempotencyField ? 'operator-mapped; server guarantee unverified' : 'not-configured' } };
}

/** Only an already-queued entry is eligible. Caller persists success AND failure receipts. */
export async function publishMemory(state: TeamState, input: ObjectValue): Promise<Json> {
  assertNoCredentials(input);
  const id = text(input.id, 'memory.id');
  const entry = state.outbox.find(item => item.id === id);
  if (!entry) throw new Error('queue and persist memory before publication');
  if (entry.status === 'published') return { id, status: 'published', receipt: entry.receipt ?? null, repeated: true };
  const previous = entry.receipt && typeof entry.receipt === 'object' && !Array.isArray(entry.receipt) ? entry.receipt as ObjectValue : {};
  if (previous.uncertain === true && input.retryUncertain !== true) {
    return { id, status: 'queued', receipt: previous, reason: 'remote outcome uncertain; reconcile before explicitly setting retryUncertain' };
  }
  if (input.url === undefined) {
    entry.receipt = { at: new Date().toISOString(), outcome: 'unavailable', reason: 'no memory endpoint configured', uncertain: false };
    return { id, status: 'queued', receipt: entry.receipt };
  }
  const url = endpoint(input.url);
  if (input.provider === 'surreal-memory' && !url.pathname.endsWith('/api/v1/memory/')) throw new Error('surreal-memory url must name the verified /api/v1/memory/ route');
  const request = publication(entry, input);
  assertNoCredentials(request.body);
  const target = { url: url.href, contract: request.contract };
  const publicationKey = digest({ id, content: entry.content, scope: entry.scope, provenance: entry.provenance, target, body: request.body });
  if (previous.publicationKey !== undefined && previous.publicationKey !== publicationKey) throw new Error('retry destination or mapping differs from recorded attempt');
  const receipt: ObjectValue = { at: new Date().toISOString(), publicationKey, contentSha256: digest(entry.content), target, localIdempotencyKey: id,
    exactlyOnce: false, uncertaintyNote: 'A crash after remote commit and before local receipt can duplicate a retry; reconcile remotely.' };
  try {
    const response = await requestJson(url, input, request.method, request.body, request.headers);
    const payload = object(response.value, 'memory response');
    const remoteId = payload[request.remoteIdField];
    if (remoteId === undefined || remoteId === null) throw new RequestFailure('remote_response_missing_id', true, response.status);
    assertNoCredentials(remoteId);
    entry.receipt = { ...receipt, outcome: 'published', httpStatus: response.status, remoteId, uncertain: false };
    entry.status = 'published';
    return { id, status: 'published', receipt: entry.receipt };
  } catch (error) {
    // Invalid configuration fails before I/O; transport and response failures
    // remain durable retryable outbox records without logging remote content.
    if (!(error instanceof RequestFailure)) {
      entry.receipt = { ...receipt, outcome: 'unavailable', reason: 'unsafe_or_unsupported_remote_response', uncertain: true };
    } else {
      entry.receipt = { ...receipt, outcome: 'unavailable', reason: error.code, httpStatus: error.httpStatus, uncertain: error.uncertain };
    }
    return { id, status: 'queued', receipt: entry.receipt };
  }
}
