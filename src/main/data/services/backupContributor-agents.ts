// AGENTS backup contributor — owns the agent session/workspace/channel graph.
//
// Co-located in the agent owning module (the agent/session/channel tables are
// authored from src/main/ai + this flat data-services dir) per backup-architecture
// §7 placement. This is the most structurally complex domain (architecture §5):
// four independent aggregate roots + two junction tables + a shared-table row-scope.
//
// Aggregate boundaries (§3.5 / §5):
//  - agent_session (+ agent_session_message via sessionId): uuid-entity, SKIP.
//    renamable:false — agent_session.workspaceId is a cross-aggregate owning FK to
//    the independent agent_workspace aggregate (§5.4); RENAME would clone a session
//    while its workspace target merges under a different id → owning FK dangles.
//  - agent_workspace: natural-key (path UNIQUE), FIELD_MERGE. renamable:false.
//    Independent aggregate root — NOT a member of agent_session (§5.4: workspaceId
//    is a cross-aggregate owning ref, excluded from members by #14).
//  - agent_channel: uuid-entity, SKIP. renamable:false (single-table).
//  - agent: uuid-entity, SKIP. renamable:false (single-table).
//
// Junction tables (not aggregate members, §5.2 — cascade-prune, not clone-inherited):
//  - agent_channel_task: composite PK, dual cascade FK (channelId→agent_channel +
//    taskId→job_schedule). agent_channel_task.taskId points at job_schedule rows
//    owned by the row-scope below; identity propagation rewrites taskId when the
//    target schedule row merges under a new canonical id (§5.4).
//  - agent_skill: composite PK, dual cascade FK (agentId→agent +
//    skillId→agent_global_skill → SKILLS domain).
//  - agent_mcp_server: composite PK, dual cascade FK (agentId→agent +
//    mcpServerId→mcp_server → MCP_SERVERS domain).
//
// Shared-table row-scope (§5 / invariant #5/#23):
//  - job_schedule.type='agent.task' → AGENTS. job_schedule is a SHARED table (other
//    types belong to other domains / runtime); AGENTS owns only the
//    type='agent.task' row partition via rowScopes. Those rows are a natural-key
//    aggregate keyed by (type,name) UNIQUE → FIELD_MERGE (agent task definitions,
//    otherwise design-loss of user tasks).
//
// JSON soft refs (§6.1):
//  - agent_session_message.data: tolerant fileEntryId attachment refs (same shape as
//    message.data in TOPICS).
//  - agent_channel.workspace.workspaceId + job_schedule(type='agent.task')
//    .jobInputTemplate.workspace.workspaceId (AgentSessionWorkspaceSource): REQUIRED
//    — target merge (agent_workspace FIELD_MERGE) must rewrite the embedded
//    workspaceId via identity propagation, or the channel/scheduled-task silently
//    references a dangling workspace (§5.4).
//
// Preset: full + lite (agent history/config is a core migrate scenario).

import type { BackupContributor } from '@main/data/db/backup/contributorTypes'
import { column, columns, mirrorPk, table } from '@main/data/db/backup/dbSchemaRefs'
import { deepFreeze } from '@main/data/db/backup/freeze'

/**
 * AGENTS domain. Four independent aggregate roots + two junction tables + one
 * shared-table row-scope. conflictDefault derives per root: uuid-entity roots →
 * SKIP; agent_workspace + job_schedule(agent.task) → natural-key → FIELD_MERGE
 * (§6.2). All aggregates are renamable:false.
 */
export const AGENTS_CONTRIBUTOR = deepFreeze<BackupContributor>({
  domain: 'AGENTS',
  schema: {
    tables: [
      table('agent'),
      table('agent_session'),
      table('agent_session_message'),
      table('agent_workspace'),
      table('agent_channel'),
      table('agent_channel_task'),
      table('agent_skill'),
      table('agent_mcp_server'),
      // job_schedule: AGENTS owns the type='agent.task' row partition. Listed as a
      // table so #12/#13 recognize its jsonSoftRef + aggregate; rowScopes below filter
      // export/restore to only agent.task rows (other job_schedule types are runtime).
      table('job_schedule')
    ],
    references: [
      // ── agent_session ──────────────────────────────────────────────────────
      // agent_session.agentId → agent (AGENTS): optional (onDelete set null). #25-required.
      { table: table('agent_session'), column: column('agentId'), referencedDomain: 'AGENTS', kind: 'optional' },
      // agent_session.workspaceId → agent_workspace (AGENTS): cross-aggregate OWNING
      // (onDelete cascade). Declared owning per #19/#25, but NOT a member of the
      // session aggregate (#14: target is a different aggregate root, not session.root).
      // See §5.4 — workspaceId is a cascade NOT NULL owning FK to an independent root.
      {
        table: table('agent_session'),
        column: column('workspaceId'),
        referencedDomain: 'AGENTS',
        kind: 'owning'
      },

      // ── agent_session_message ──────────────────────────────────────────────
      // agent_session_message.sessionId → agent_session: same-domain owning (cascade).
      // Drives aggregate membership (#14/#15) — include member viaColumn.
      {
        table: table('agent_session_message'),
        column: column('sessionId'),
        referencedDomain: 'AGENTS',
        kind: 'owning'
      },
      // agent_session_message.modelId → user_model (PROVIDERS): optional (onDelete set null). #25-required.
      {
        table: table('agent_session_message'),
        column: column('modelId'),
        referencedDomain: 'PROVIDERS',
        kind: 'optional'
      },

      // ── agent_channel ──────────────────────────────────────────────────────
      // agent_channel.agentId → agent (AGENTS): optional (onDelete set null). #25-required.
      { table: table('agent_channel'), column: column('agentId'), referencedDomain: 'AGENTS', kind: 'optional' },
      // agent_channel.sessionId → agent_session (AGENTS): optional (onDelete set null). #25-required.
      { table: table('agent_channel'), column: column('sessionId'), referencedDomain: 'AGENTS', kind: 'optional' },

      // ── agent_channel_task (junction: dual cascade) ────────────────────────
      // channelId → agent_channel: same-domain junction (cascade). #25-required.
      {
        table: table('agent_channel_task'),
        column: column('channelId'),
        referencedDomain: 'AGENTS',
        kind: 'junction'
      },
      // taskId → job_schedule (AGENTS row-scope): same-domain junction (cascade).
      // Target is the job_schedule(type='agent.task') row partition owned below.
      // #25-required; identity propagation rewrites taskId on target FIELD_MERGE (§5.4).
      {
        table: table('agent_channel_task'),
        column: column('taskId'),
        referencedDomain: 'AGENTS',
        kind: 'junction'
      },

      // ── agent_skill (junction: dual cascade) ───────────────────────────────
      // agentId → agent: same-domain junction (cascade). #25-required.
      { table: table('agent_skill'), column: column('agentId'), referencedDomain: 'AGENTS', kind: 'junction' },
      // skillId → agent_global_skill (SKILLS): cross-domain junction (cascade). #25-required.
      { table: table('agent_skill'), column: column('skillId'), referencedDomain: 'SKILLS', kind: 'junction' },

      // ── agent_mcp_server (junction: dual cascade) ──────────────────────────
      // agentId → agent: same-domain junction (cascade). #25-required.
      { table: table('agent_mcp_server'), column: column('agentId'), referencedDomain: 'AGENTS', kind: 'junction' },
      // mcpServerId → mcp_server (MCP_SERVERS): cross-domain junction (cascade). #25-required.
      {
        table: table('agent_mcp_server'),
        column: column('mcpServerId'),
        referencedDomain: 'MCP_SERVERS',
        kind: 'junction'
      },

      // ── agent (scalar model refs) ──────────────────────────────────────────
      // agent.model / planModel / smallModel → user_model (PROVIDERS): optional
      // (onDelete set null). Three #25-required FKs.
      { table: table('agent'), column: column('model'), referencedDomain: 'PROVIDERS', kind: 'optional' },
      { table: table('agent'), column: column('planModel'), referencedDomain: 'PROVIDERS', kind: 'optional' },
      { table: table('agent'), column: column('smallModel'), referencedDomain: 'PROVIDERS', kind: 'optional' }
    ],
    primaryKeys: [
      mirrorPk('agent'),
      mirrorPk('agent_session'),
      mirrorPk('agent_session_message'),
      mirrorPk('agent_workspace'),
      mirrorPk('agent_channel'),
      mirrorPk('agent_channel_task'),
      mirrorPk('agent_skill'),
      mirrorPk('agent_mcp_server'),
      mirrorPk('job_schedule')
    ],
    aggregates: [
      // agent_session + agent_session_message: uuid-entity, SKIP, non-renamable.
      {
        root: table('agent_session'),
        identityKey: columns(['id']),
        members: [{ table: table('agent_session_message'), viaColumn: column('sessionId'), cascade: 'include' }],
        renamable: false
      },
      // agent_workspace: natural-key (path UNIQUE), FIELD_MERGE, non-renamable.
      // identityKey includes the UNIQUE non-PK column `path` (§6.2 unique-backing).
      // identityClass explicit — root PK `id` is uuid, so the finalize default
      // (uuid-entity→SKIP) would mis-derive; `path` is the business identity (§5.4).
      {
        root: table('agent_workspace'),
        identityKey: columns(['path']),
        identityClass: 'natural-key',
        renamable: false
      },
      // agent_channel: single-table uuid-entity, SKIP, non-renamable.
      {
        root: table('agent_channel'),
        identityKey: columns(['id']),
        renamable: false
      },
      // agent: single-table uuid-entity, SKIP, non-renamable.
      {
        root: table('agent'),
        identityKey: columns(['id']),
        renamable: false
      },
      // job_schedule(type='agent.task') row-scope: natural-key ((type,name) UNIQUE),
      // FIELD_MERGE. Root is the shared job_schedule table; ownership is row-scoped
      // (only type='agent.task' rows belong to AGENTS). non-renamable.
      // identityClass explicit — root PK `id` is uuid, finalize default would
      // mis-derive uuid-entity→SKIP; (type,name) is the business identity (§5.4).
      {
        root: table('job_schedule'),
        identityKey: columns(['type', 'name']),
        identityClass: 'natural-key',
        renamable: false
      }
    ],
    // Shared-table row partition: job_schedule.type='agent.task' → AGENTS.
    // Other job_schedule types are not owned here (invariant #5/#23 row-scope coverage).
    rowScopes: [
      {
        table: table('job_schedule'),
        ownerDomain: 'AGENTS',
        filter: { column: column('type'), op: 'eq', value: 'agent.task' },
        // Exhaustive Record<JobType, 'owned'|'excluded'> — every key in the JobRegistry
        // union is classified so an unhandled JobType can never be silently dropped
        // (finalize #23). Compile-time exhaustiveness: adding a new JobType to
        // JobRegistry without classifying it here fails tsc.
        typeCoverage: {
          // agent.task — the only job_schedule type owned by AGENTS (matched by the
          // filter above; a scheduled agent task definition).
          'agent.task': 'owned',
          // Every other JobType belongs to a different concern or is runtime-only —
          // its job_schedule rows are not AGENTS-backed and are excluded here.
          'file-processing.background': 'excluded', // FILE_PROCESSING concern
          'file-processing.remote-poll': 'excluded', // FILE_PROCESSING concern
          'knowledge.prepare-root': 'excluded', // KNOWLEDGE concern
          'knowledge.index-documents': 'excluded', // KNOWLEDGE concern
          'knowledge.check-file-processing-result': 'excluded', // KNOWLEDGE concern
          'knowledge.delete-subtree': 'excluded', // KNOWLEDGE concern
          'knowledge.reindex-subtree': 'excluded', // KNOWLEDGE concern
          'image-generation.generate': 'excluded', // PROVIDERS/image-generation concern
          // Test-only JobType fixtures (registered via declare module in job
          // __tests__) — not real jobs, excluded from AGENTS ownership. Listed so
          // the Record stays compile-time exhaustive when tests are in the type graph.
          'dummy.echo': 'excluded', // test fixture (JobManager.schedule.test)
          'test.contract.alpha': 'excluded', // test fixture (jobRegistry.test)
          'test.contract.beta': 'excluded' // test fixture (jobRegistry.test)
        }
      }
    ],
    fileRefSourcePolicies: [],
    jsonSoftReferences: [
      // agent_session_message.data embeds attachment fileEntryId soft refs (tolerant —
      // missing blob degrades to a toast + orphan check, no identity propagation, §5.4).
      {
        table: table('agent_session_message'),
        column: column('data'),
        target: 'file-ref',
        ownerDomain: 'AGENTS',
        kind: 'tolerant'
      },
      // agent_channel.workspace embeds an AgentSessionWorkspaceSource whose workspaceId
      // points at an agent_workspace (natural-key target). REQUIRED — target FIELD_MERGE
      // must rewrite the embedded workspaceId via identity propagation (§5.4), or the
      // channel silently references a dangling/merged-away workspace.
      {
        table: table('agent_channel'),
        column: column('workspace'),
        target: 'entity-id',
        ownerDomain: 'AGENTS',
        kind: 'required'
      },
      // job_schedule(type='agent.task').jobInputTemplate embeds the same
      // AgentSessionWorkspaceSource.workspaceId. REQUIRED for the same reason — a
      // scheduled agent task whose workspace id was merged away would fire against a
      // dangling workspace. Covers the shared job_schedule table's agent.task rows.
      {
        table: table('job_schedule'),
        column: column('jobInputTemplate'),
        target: 'entity-id',
        ownerDomain: 'AGENTS',
        kind: 'required'
      }
    ],
    // Structural JSON columns that carry NO cross-entity soft refs (no embedded
    // fileId/entityId) — declared here so finalize #12 exhaustiveness is satisfied.
    // The jsonSoftReferences above (agent_session_message.data, agent_channel.workspace,
    // job_schedule.jobInputTemplate) are the only JSON columns carrying soft refs.
    exemptJsonCols: [
      // ── agent ──────────────────────────────────────────────────────────────
      {
        table: table('agent'),
        column: column('disabledTools'),
        reason: 'no soft refs — holds list of disabled tool-name strings'
      },
      {
        table: table('agent'),
        column: column('configuration'),
        reason: 'no soft refs — holds agent runtime configuration knobs'
      },
      // ── agent_channel ──────────────────────────────────────────────────────
      // (workspace IS a jsonSoftReference — NOT exempt; see jsonSoftReferences above.)
      {
        table: table('agent_channel'),
        column: column('config'),
        reason: 'no soft refs — holds channel UI/runtime config'
      },
      {
        table: table('agent_channel'),
        column: column('activeChatIds'),
        reason: 'no soft refs — holds list of active chat id strings (transient UI state)'
      },
      // ── agent_session_message ──────────────────────────────────────────────
      // (data IS a jsonSoftReference — NOT exempt.)
      {
        table: table('agent_session_message'),
        column: column('modelSnapshot'),
        reason: 'no soft refs — holds a frozen snapshot of the model config at send time'
      },
      {
        table: table('agent_session_message'),
        column: column('stats'),
        reason: 'no soft refs — holds token/usage statistics'
      },
      // ── job_schedule ────────────────────────────────────────────────────────
      // (jobInputTemplate IS a jsonSoftReference — NOT exempt.)
      {
        table: table('job_schedule'),
        column: column('trigger'),
        reason: 'no soft refs — holds the schedule trigger spec (cron/event)'
      },
      {
        table: table('job_schedule'),
        column: column('catchUpPolicy'),
        reason: 'no soft refs — holds missed-run catch-up policy'
      },
      {
        table: table('job_schedule'),
        column: column('metadata'),
        reason: 'no soft refs — holds opaque schedule metadata'
      }
    ]
  },
  backupPolicy: {},
  // All aggregates are renamable:false → cloneAggregate is NOT required (#16).
  // D model (#16714 / architecture §9): no afterImport re-arm — relaunch after
  // preboot promotion re-arms agent.task schedules via JobManager startup recovery.
  operations: undefined
})
