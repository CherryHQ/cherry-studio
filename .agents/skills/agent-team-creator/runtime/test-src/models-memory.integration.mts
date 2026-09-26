// Packaged CLI processes exercise real JSON input, policy adaptation and durable files.
// Catalogs below are explicit operator fixtures, not fabricated discovery responses.
// No fake servers or live memory writes. Successful remote publication is unverified.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import { randomUUID } from 'node:crypto';
import { fixture, team } from './fixture.mjs';

const capabilities = { function_calling: true, vision: true, reasoning: true, structured_output: true };
function bundle(ids = ['alpha', 'beta']) {
  return {
    catalog: {
      $schema_version: 1,
      $provenance: { source: 'operator integration fixture', source_sha256: 'fixture-not-a-source-attestation', fetched: '2020-01-01', library_version: 'fixture' },
      providers: { fixture: { models: {
        priced: { id: 'priced', capabilities, pricing: { input_cost_per_token: 0.000001, output_cost_per_token: 0.000002 } },
      } } },
    },
    availableModels: ids,
    aliases: Object.fromEntries(ids.map(id => [id, { provider: 'fixture', model: 'priced' }])),
    tiers: Object.fromEntries(ids.map(id => [id, 'medium'])),
    maxCatalogAgeDays: 30,
  };
}

const entry = () => ({ content: 'Keep review evidence separate from implementation claims.', scope: 'team:example', provenance: { evidence: ['review-note'], task: 'documentation' } });
const stateBytes = (f: ReturnType<typeof fixture>) => fs.readFileSync(f.state);
function initialize(f: ReturnType<typeof fixture>) {
  f.call('init', { state: f.state, team: team() });
  return f.call('memory-queue', { state: f.state, expectedRevision: 0, entry: entry() });
}

async function closedPort(): Promise<number> {
  // Reserve an ephemeral address, then close it before the CLI request. This
  // server never handles a request and never supplies a fabricated API response.
  const server = net.createServer();
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return address.port;
}

test('packaged model selection resolves every layer and ANDs capabilities', t => {
  const f = fixture(); t.after(f.close);
  const base = team();
  const configured = {
    ...base,
    modelPolicy: { model: 'team-choice', tier: 'low', maxInputPerMillion: 8, capabilities: ['function_calling'] },
    roles: base.roles.map(role => ({ ...role, modelPolicy: { model: 'role-choice', tier: 'medium', maxInputPerMillion: 6, capabilities: ['vision'] } })),
    skillPolicies: {
      first: { model: 'skill-first', tier: 'hard', maxInputPerMillion: 5, capabilities: ['reasoning'] },
      second: { model: 'skill-second', tier: 'low', maxInputPerMillion: 4, capabilities: ['structured_output'] },
    },
  };
  const result = f.call('models-select', { team: configured, roleId: 'implementer', skills: ['first', 'second'],
    taskPolicy: { model: 'alpha', tier: 'medium', maxInputPerMillion: 3, maxOutputPerMillion: 6, capabilities: [] }, catalog: bundle() });
  assert.equal(result.selected.id, 'alpha');
  assert.deepEqual(result.appliedLayers, ['team', 'role', 'skill:first', 'skill:second', 'task']);
  assert.deepEqual(result.policy, { model: 'alpha', tier: 'medium', maxInputPerMillion: 3, maxOutputPerMillion: 6,
    capabilities: ['function_calling', 'vision', 'reasoning', 'structured_output'] });
  const ordered = bundle(['skill-first', 'skill-second']);
  ordered.tiers = { 'skill-first': 'hard', 'skill-second': 'low' };
  for (const skills of [['first', 'second'], ['second', 'first']]) {
    const selected = f.call('models-select', { team: configured, roleId: 'implementer', skills, catalog: ordered });
    assert.equal(selected.selected.id, skills[1] === 'first' ? 'skill-first' : 'skill-second');
  }
});

test('packaged catalog adaptation converts per-token cost and makes deterministic price ties explicit', t => {
  const f = fixture(); t.after(f.close);
  const request = { team: team(), roleId: 'implementer', taskPolicy: { tier: 'medium', maxInputPerMillion: 1, maxOutputPerMillion: 2 } };
  const selected = f.call('models-select', { ...request, catalog: bundle(['beta', 'alpha']) });
  const repeated = f.call('models-select', { ...request, catalog: bundle(['alpha', 'beta']) });
  assert.equal(selected.selected.id, 'alpha');
  assert.equal(repeated.selected.id, selected.selected.id);
  assert.deepEqual(selected.selected.pricing, { inputPerMillion: 1, outputPerMillion: 2, currency: 'USD', basis: 'maximum-known-context-tier', sourceUnit: 'per-token' });
  assert.equal(selected.selected.catalogId, 'priced');
  assert.equal(selected.selected.provenance.availabilityBasis, 'operator-declared');
  assert.equal(selected.selected.provenance.discovery, null);
  assert.equal(selected.selected.freshness.stale, true);
  assert.equal(selected.catalogProvenance.source, 'operator integration fixture');
  assert.ok(selected.warnings.some((warning: string) => /stale.*current provider rates/.test(warning)));
  assert.ok(selected.warnings.some((warning: string) => /operator-declared/.test(warning)));
});

test('ceilings reject context-tier costs, unknown prices and unknown capabilities', t => {
  const f = fixture(); t.after(f.close);
  const catalog = {
    catalog: { $schema_version: 1, providers: { fixture: { models: {
      costly: { capabilities, pricing: { input_cost_per_token: 0.000001, output_cost_per_token: 0.000002,
        tiers: [{ min_context_tokens: 200000, input_cost_per_token: 0.000004, output_cost_per_token: 0.000008 }] } },
      unpriced: { capabilities },
      unknown: { pricing: { input_cost_per_token: 0, output_cost_per_token: 0 } },
    } } } },
    availableModels: ['costly', 'unpriced', 'unknown'],
    aliases: Object.fromEntries(['costly', 'unpriced', 'unknown'].map(id => [id, { provider: 'fixture', model: id }])),
    tiers: { costly: 'hard', unpriced: 'hard', unknown: 'hard' },
  };
  const result = f.call('models-select', { team: team(), roleId: 'implementer', taskPolicy: { tier: 'hard', capabilities: ['vision'], maxInputPerMillion: 2 }, catalog });
  assert.equal(result.selected, null);
  const reasons = (id: string): string[] => result.rejected.find((row: { id: string }) => row.id === id).reasons;
  assert.ok(reasons('costly').includes('price exceeds ceiling'));
  assert.ok(reasons('unpriced').includes('price unknown; cannot satisfy ceiling'));
  assert.ok(reasons('unknown').includes('capability vision unsupported or unknown'));
  const allowedUnknown = f.call('models-select', { team: team(), roleId: 'implementer', taskPolicy: { model: 'unpriced', tier: 'hard', capabilities: ['vision'] }, catalog });
  assert.equal(allowedUnknown.selected.pricing.inputPerMillion, null);
  assert.ok(allowedUnknown.warnings.some((warning: string) => /freshness is unknown/.test(warning)));
});

test('names never infer tiers or aliases, and a static catalog never proves availability', t => {
  const f = fixture(); t.after(f.close);
  const catalog = bundle(['ultra-hard-model']);
  catalog.tiers = {};
  const noTier = f.call('models-select', { team: team(), roleId: 'implementer', taskPolicy: { tier: 'hard' }, catalog });
  assert.equal(noTier.selected, null);
  assert.ok(noTier.rejected[0].reasons.includes('declared tier missing or different'));
  catalog.tiers = { 'ultra-hard-model': 'low' };
  assert.equal(f.call('models-select', { team: team(), roleId: 'implementer', taskPolicy: { tier: 'low' }, catalog }).selected.id, 'ultra-hard-model');
  const noAlias = { ...bundle(['priced']), aliases: {} };
  const result = f.call('models-select', { team: team(), roleId: 'implementer', taskPolicy: { maxInputPerMillion: 10 }, catalog: noAlias });
  assert.equal(result.selected, null, 'identical catalog model name does not imply an alias mapping');
  const noAvailability = f.call('models-select', { team: team(), roleId: 'implementer', catalog: { catalog: bundle().catalog } });
  assert.equal(noAvailability.selected, null);
});

test('packaged CLI rejects invalid catalog mappings and task policies explicitly', t => {
  const f = fixture(); t.after(f.close);
  const request = { team: team(), roleId: 'implementer' };
  const invalid = bundle(); invalid.aliases.alpha = { provider: 'fixture', model: 'absent' };
  assert.match(f.call('models-select', { ...request, catalog: invalid }, 1).error, /mapping.*catalog model/);
  const version = bundle(); version.catalog.$schema_version = 2;
  assert.match(f.call('models-select', { ...request, catalog: version }, 1).error, /schema_version 1/);
  assert.match(f.call('models-select', { ...request, taskPolicy: { guessedTier: 'hard' }, catalog: bundle() }, 1).error, /Unknown.*modelPolicy/);
  assert.match(f.call('models-select', { ...request, taskPolicy: { maxInputPerMillion: -1 }, catalog: bundle() }, 1).error, /Invalid.*maxInputPerMillion/);
});

test('discovery refuses literal credentials, unsafe URLs and invalid environment references before any network request', t => {
  const f = fixture(); t.after(f.close);
  const base = { kind: 'openai', baseUrl: 'http://127.0.0.1:1' };
  const errors = [
    f.call('models-discover', { ...base, auth: { apiKey: 'synthetic-placeholder' } }, 1),
    f.call('models-discover', { ...base, auth: { env: 'INVALID-NAME' } }, 1),
    f.call('models-discover', { ...base, auth: { env: 'TEAM_INTEGRATION_ABSENT_CREDENTIAL' } }, 1, { ...process.env, TEAM_INTEGRATION_ABSENT_CREDENTIAL: '' }),
    f.call('models-discover', { kind: 'openai', discoveryUrl: 'https://user:synthetic-placeholder@example.invalid/v1/models' }, 1),
    f.call('models-discover', { kind: 'openai', discoveryUrl: 'https://example.invalid/v1/models?api_key=synthetic-placeholder' }, 1),
  ];
  assert.match(errors[0].error, /credential fields/);
  assert.match(errors[1].error, /invalid_auth_environment_reference/);
  assert.match(errors[2].error, /credential_environment_unavailable/);
  assert.match(errors[3].error, /without userinfo/);
  assert.match(errors[4].error, /URL credentials/);
  assert.equal(JSON.stringify(errors).includes('synthetic-placeholder'), false);
});

test('memory queue is durable across CLI restarts, idempotent, scoped, and refuses identity conflicts', t => {
  const f = fixture(); t.after(f.close);
  const queued = initialize(f);
  assert.equal(queued.revision, 1);
  const id = queued.outbox[0].id;
  const before = stateBytes(f);
  const restarted = f.call('status', { state: f.state });
  assert.equal(restarted.outbox[0].scope, 'team:example');
  assert.equal(restarted.outbox[0].provenance.teamId, 'example');
  assert.match(restarted.outbox[0].provenance.authority, /unverified mirrors/);
  const repeated = f.call('memory-queue', { state: f.state, expectedRevision: 1,
    entry: { ...entry(), provenance: { task: 'documentation', evidence: ['review-note'] } } });
  assert.equal(repeated.revision, 1);
  assert.equal(repeated.outbox.length, 1);
  assert.equal(repeated.outbox[0].id, id);
  assert.deepEqual(stateBytes(f), before);
  for (const changed of [{ ...entry(), id, scope: 'team:another' }, { ...entry(), id, content: 'Different content' }]) {
    assert.match(f.call('memory-queue', { state: f.state, expectedRevision: 1, entry: changed }, 1).error, /conflicts/);
    assert.deepEqual(stateBytes(f), before);
  }
  const independent = f.call('memory-queue', { state: f.state, expectedRevision: 1, entry: { ...entry(), scope: 'team:another' } });
  assert.equal(independent.outbox.length, 2);
  assert.notEqual(independent.outbox[1].id, id);
});

test('no memory service preserves queued content and durable unavailable receipt', t => {
  const f = fixture(); t.after(f.close);
  const queued = initialize(f), id = queued.outbox[0].id;
  const result = f.call('memory-publish', { state: f.state, expectedRevision: 1, publication: { id } });
  assert.equal(result.publication.status, 'queued');
  assert.equal(result.publication.receipt.uncertain, false);
  assert.match(result.publication.receipt.reason, /no memory endpoint/);
  const restarted = f.call('status', { state: f.state });
  assert.equal(restarted.outbox[0].content, entry().content);
  assert.deepEqual(restarted.outbox[0].receipt, result.publication.receipt);
  assert.equal(restarted.outbox[0].status, 'queued');
  assert.deepEqual(restarted.events, [], 'memory events must not fabricate canonical KBD boundaries');
});

test('closed real loopback endpoint preserves durable uncertainty and requires explicit retry', async t => {
  const f = fixture(); t.after(f.close);
  const queued = initialize(f), id = queued.outbox[0].id;
  const port = await closedPort();
  const publication = { id, provider: 'surreal-memory', url: `http://127.0.0.1:${port}/api/v1/memory/`, timeoutMs: 1000,
    scopeMapping: { scope: 'team:example', agentId: 'fixture-agent', userId: 'anonymous' } };
  const failed = f.call('memory-publish', { state: f.state, expectedRevision: 1, publication });
  assert.equal(failed.publication.status, 'queued');
  assert.equal(failed.publication.receipt.uncertain, true, 'transport failures are conservatively uncertain');
  assert.equal(failed.publication.receipt.exactlyOnce, false);
  assert.equal(failed.publication.receipt.reason, 'transport_unavailable_or_redirect_refused');
  assert.equal(failed.publication.receipt.target.contract.remoteIdempotency, 'unsupported-by-verified-contract');
  const restarted = f.call('status', { state: f.state });
  assert.deepEqual(restarted.outbox[0].receipt, failed.publication.receipt);
  const before = stateBytes(f);
  const deferred = f.call('memory-publish', { state: f.state, expectedRevision: restarted.revision, publication });
  assert.match(deferred.publication.reason, /reconcile/);
  assert.deepEqual(stateBytes(f), before, 'deferred retry must retain exact receipt and revision');
  const conflict = f.call('memory-publish', { state: f.state, expectedRevision: restarted.revision,
    publication: { ...publication, retryUncertain: true, scopeMapping: { ...publication.scopeMapping, agentId: 'different-agent' } } }, 1);
  assert.match(conflict.error, /mapping differs/);
  assert.deepEqual(stateBytes(f), before);
  const retried = f.call('memory-publish', { state: f.state, expectedRevision: restarted.revision, publication: { ...publication, retryUncertain: true } });
  assert.equal(retried.publication.status, 'queued');
  assert.equal(retried.publication.receipt.publicationKey, failed.publication.receipt.publicationKey);
  assert.equal(retried.state.outbox.length, 1);
  assert.equal(retried.state.outbox[0].content, entry().content);
});

test('invalid memory scope mapping, unsupported KBD reference and credentials cannot change durable state', t => {
  const f = fixture(); t.after(f.close);
  const queued = initialize(f), id = queued.outbox[0].id;
  const before = stateBytes(f);
  assert.match(f.call('memory-publish', { state: f.state, expectedRevision: 1, publication: {
    id, provider: 'surreal-memory', url: 'http://127.0.0.1:1/api/v1/memory/', scopeMapping: { scope: 'team:wrong', agentId: 'fixture-agent' },
  } }, 1).error, /match.*scope/);
  assert.deepEqual(stateBytes(f), before);
  assert.match(f.call('memory-queue', { state: f.state, expectedRevision: 1, entry: { ...entry(), provenance: { kbd: {
    projectId: 'project', runId: 'run', phaseId: 'phase', changeId: 'change', taskId: 'task',
  } } } }, 1).error, /linked team task/);
  assert.deepEqual(stateBytes(f), before);
  const secret = `synthetic-${randomUUID()}`;
  const rejected = f.call('memory-queue', { state: f.state, expectedRevision: 1, entry: { ...entry(), content: secret } }, 1,
    { ...process.env, TEAM_INTEGRATION_API_KEY: secret });
  assert.match(rejected.error, /credential values/);
  assert.equal(JSON.stringify(rejected).includes(secret), false);
  assert.deepEqual(stateBytes(f), before);
});
