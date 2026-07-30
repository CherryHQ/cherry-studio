import { stat } from 'node:fs/promises'

import { type AppliedMigration, readAppliedChain } from '@data/db/restore/appliedChain'
import { agentTable } from '@data/db/schemas/agent'
import { agentChannelTable } from '@data/db/schemas/agentChannel'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { fileEntryTable } from '@data/db/schemas/file'
import { jobScheduleTable, jobTable } from '@data/db/schemas/job'
import { knowledgeItemTable } from '@data/db/schemas/knowledge'
import { mcpServerTable } from '@data/db/schemas/mcpServer'
import { noteTable } from '@data/db/schemas/note'
import { preferenceTable } from '@data/db/schemas/preference'
import type { DbOrTx } from '@data/db/types'
import {
  DISCONNECTED_AGENT_WORKSPACE_DIRECTORY,
  sanitizeAgentAutomation,
  toDisconnectedAgentWorkspaceSegment
} from '@main/ai/agents/portableProfilePolicy'
import { sanitizeAgentChannelCapability } from '@main/ai/channelPortableProfilePolicy'
import { sanitizeMcpServerCapability } from '@main/ai/mcp/portableProfilePolicy'
import { ACTIVE_JOB_STATUSES, JobStatusAtomSchema } from '@shared/data/api/schemas/jobs'
import { KNOWLEDGE_ITEM_STATUSES } from '@shared/data/types/knowledge'
import Database from 'better-sqlite3'
import { and, eq, inArray, notInArray, or, type SQL, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core'

import { assertDbIntegrity, assertNoDbSidecars, sealDetachedDb } from '../dbSeal'
import { BackupCancelledError } from '../errors'
import { sha256FileCancellable } from '../hashing'
import { classifyManagedPath, type ManagedRootRebaseTable, targetLocalPath } from './managedPathRebase'
import { CODE_CLI_CONFIGS_KEY, PREFERENCE_RESET_KEYS, sanitizeCodeCliConfigs } from './preferenceResetPolicy'
import { JOB_SCHEDULE_AUTOMATION_PATCH, resetKnowledgeItemStatus } from './tablePolicy'

/**
 * Portable-database materialization (docs/references/backup/README.md §3, §3.1) —
 * the one place the Phase 1c-i policy is actually applied to a DETACHED SQLite
 * file.
 *
 * Every archive carries the SAME complete database: no domain is stripped and no
 * target row is ever consulted, so one source snapshot always yields a
 * byte-equivalent business payload. Materialization only rewrites the
 * archive's own file, which is what keeps it archive processing rather than a row
 * merge (§3.1 invariant).
 *
 * It runs at two independent moments, deliberately applying the same policy twice
 * ({@link MaterializeMode}):
 *
 * - `export` — sanitize the fresh `VACUUM INTO` snapshot, so an archive never
 *   ships an armed capability or another device's runtime state in the first
 *   place. Producer paths are left intact; the manifest records the producer's
 *   managed roots so the consumer can rebase them deterministically.
 * - `restore` — re-sanitize an admitted archive against TARGET policy and rebase
 *   managed paths. Re-running the reset is not redundancy theatre: an archive is
 *   untrusted input, and a hostile-but-self-consistent database can be crafted
 *   with `is_active = 1` however carefully the producer side behaved.
 *
 * All row work happens inside ONE transaction on the detached file, so an
 * injected failure leaves the database exactly as it was found. Sealing
 * (checkpoint, WAL exit, sidecar proof) and hashing follow the commit through the
 * shared {@link ../dbSeal} primitives.
 */

/**
 * Which side is materializing. A discriminated union rather than an optional
 * rebase table: the export side has no target roots to rebase onto, and this
 * makes passing one there a type error instead of a silent path rewrite.
 */
export type MaterializeMode =
  | { readonly kind: 'export' }
  | { readonly kind: 'restore'; readonly rebase: ManagedRootRebaseTable }

export interface MaterializeInputs {
  /** Absolute path to the detached database. Mutated in place. */
  readonly dbPath: string
  readonly mode: MaterializeMode
  /** Cancels the post-commit hash; row work is synchronous and uninterruptible. */
  readonly signal?: AbortSignal
}

export type MaterializationDegradationReason =
  /** A known capability JSON field did not match its declared shape; the sanitizer failed that field closed. */
  | 'capability-malformed'
  /** An external file reference was removed because its absolute path can trigger automatic local/network I/O. */
  | 'external-file-dropped'
  /** A managed path could not be rebased portably, so the row keeps its producer path as inert metadata. */
  | 'path-unportable'
  /** The rebased path is already claimed by another row, so this row cannot take it. */
  | 'path-collision'
  /** An agent workspace pointed somewhere this device will not honour; the binding was replaced by a local placeholder. */
  | 'workspace-disconnected'

/** One row that survived materialization in a reduced form. */
export interface MaterializationDegradation {
  readonly table: string
  readonly rowId: string
  readonly reason: MaterializationDegradationReason
  /** Structural detail only — never a stored value (archives carry plaintext credentials, §5.1.1). */
  readonly detail?: string
}

/**
 * What materialization changed. Surfaced to the restore report so a user can see
 * which capabilities were disarmed and which paths did not survive portably —
 * a degraded restore must never look like a complete one (§4).
 */
export interface MaterializationSummary {
  readonly activeJobsDeleted: number
  readonly schedulesDisabled: number
  readonly mcpServersSanitized: number
  readonly agentsSanitized: number
  readonly channelsSanitized: number
  readonly knowledgeItemsReset: number
  readonly externalFileEntriesDeleted: number
  readonly preferencesDeleted: number
  readonly codeCliConfigsRewritten: number
  readonly codeCliConfigsDeleted: number
  readonly pathsRebased: number
  readonly pathsExternal: number
  readonly degradations: readonly MaterializationDegradation[]
}

/**
 * Fold degradations into a bounded per-`(table, reason)` report.
 *
 * AGGREGATED, never per row: a profile can produce tens of thousands of degraded
 * rows, and both carriers of this list are size-capped (the manifest, the restore
 * journal). The counts answer the question a report actually asks — "what was
 * reduced, and how much of it" — while the database itself keeps the per-row
 * truth.
 *
 * `origin` records WHERE the reduction happened, because the two are not
 * interchangeable to a reader: `portable-db` ran on the producer when the archive
 * was written, `restore-db` ran on THIS device while materializing it.
 */
export function summarizeMaterializationDegradations(
  degradations: readonly MaterializationDegradation[],
  origin: 'portable-db' | 'restore-db'
): Array<{ kind: string; reason: string }> {
  const counts = new Map<string, { table: string; reason: string; count: number }>()
  for (const degradation of degradations) {
    const key = `${degradation.table}\u0000${degradation.reason}`
    const existing = counts.get(key)
    if (existing) {
      existing.count++
      continue
    }
    counts.set(key, { table: degradation.table, reason: degradation.reason, count: 1 })
  }
  return [...counts.values()].map(({ table, reason, count }) => ({
    kind: `${origin}:${table}`,
    reason: `${reason} (${count} row${count === 1 ? '' : 's'})`
  }))
}

export interface MaterializedDatabase {
  readonly summary: MaterializationSummary
  /** SHA-256 of the sealed file — the identity later recorded in the manifest or the restore journal. */
  readonly hash: string
  readonly sizeBytes: number
  /** The applied chain, proven unchanged by materialization. */
  readonly chain: readonly AppliedMigration[]
}

/**
 * Read a JSON column as its raw stored TEXT.
 *
 * Drizzle's `mode: 'json'` mapper calls `JSON.parse` while building rows, so a
 * hostile archive storing `{` in a JSON column would throw inside the query
 * rather than reaching a sanitizer. Selecting the raw text keeps decoding under
 * our control ({@link decodeJsonColumn}).
 */
function jsonTextOf(column: SQLiteColumn): SQL<string | null> {
  return sql<string | null>`${column}`
}

/**
 * Assign a row's `updated_at` to itself, suppressing the schema's
 * `$onUpdateFn(Date.now)` for this write.
 *
 * Required on EVERY update here, for two reasons. Materialization is archive
 * processing, not a user edit: bumping `updated_at` would rewrite a
 * user-meaningful "last modified" on rows the user never touched. And the wall
 * clock would make the output a non-reproducible function of its input, breaking
 * both the deterministic-metadata seal and the proof that one source snapshot
 * yields a byte-equivalent database.
 */
function preserveUpdatedAt(column: SQLiteColumn): SQL<number> {
  return sql<number>`${column}`
}

/**
 * Sentinel for a JSON column whose stored text is not JSON at all. It matches no
 * capability schema, so every sanitizer reports it malformed. Executable and
 * automatic fields fail closed; an agent channel's inert `config` is deliberately
 * preserved because `is_active = false` blocks I/O and activation validates it.
 */
const MALFORMED_JSON: unique symbol = Symbol('backup:malformed-json')

/** SQL `NULL` stays a legitimate "unset"; anything unparseable becomes {@link MALFORMED_JSON}. */
function decodeJsonColumn(raw: string | null): unknown {
  if (raw === null) return null
  try {
    return JSON.parse(raw)
  } catch {
    return MALFORMED_JSON
  }
}

/** A planned single-column/tuple rebase, plus the values to persist if it wins. */
interface RebaseCandidate<TWrite> {
  readonly id: string
  /** The row's current value of the unique key. */
  readonly currentKey: string
  /** The value the key would take, or `null` when this row is not being rebased. */
  readonly nextKey: string | null
  readonly write: TWrite
}

interface ResolvedRebases<TWrite> {
  readonly applied: readonly { readonly id: string; readonly write: TWrite }[]
  readonly collided: readonly string[]
}

/**
 * Decide which planned rebases can be written without breaking the table's unique
 * constraint.
 *
 * The source database already satisfies that constraint, so every CURRENT key is
 * distinct and can be reserved up front. A planned key another row still owns
 * loses, and that row keeps its producer path as inert metadata rather than being
 * deleted — `agent_session.workspace_id` cascades from `agent_workspace`, so
 * dropping a colliding workspace row would silently take the user's sessions and
 * their messages with it.
 *
 * Only a crafted archive can reach this: a collision needs a producer-side
 * external path equal to a TARGET managed path. Resolution is id-ordered so the
 * same archive always degrades the same row, and it is deliberately not
 * optimal — a row that loses to a key its owner later vacates stays degraded
 * instead of being re-planned.
 */
function resolveRebaseWrites<TWrite>(candidates: readonly RebaseCandidate<TWrite>[]): ResolvedRebases<TWrite> {
  const owner = new Map<string, string>()
  for (const candidate of candidates) owner.set(candidate.currentKey, candidate.id)

  const applied: { id: string; write: TWrite }[] = []
  const collided: string[] = []
  const ordered = [...candidates].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))

  for (const candidate of ordered) {
    if (candidate.nextKey === null || candidate.nextKey === candidate.currentKey) continue
    const holder = owner.get(candidate.nextKey)
    if (holder !== undefined && holder !== candidate.id) {
      collided.push(candidate.id)
      continue
    }
    owner.delete(candidate.currentKey)
    owner.set(candidate.nextKey, candidate.id)
    applied.push({ id: candidate.id, write: candidate.write })
  }

  return { applied, collided }
}

/** Mutable accumulator for one materialization pass. */
class SummaryBuilder {
  activeJobsDeleted = 0
  schedulesDisabled = 0
  mcpServersSanitized = 0
  agentsSanitized = 0
  channelsSanitized = 0
  knowledgeItemsReset = 0
  externalFileEntriesDeleted = 0
  preferencesDeleted = 0
  codeCliConfigsRewritten = 0
  codeCliConfigsDeleted = 0
  pathsRebased = 0
  pathsExternal = 0
  readonly degradations: MaterializationDegradation[] = []

  degrade(table: string, rowId: string, reason: MaterializationDegradationReason, detail?: string): void {
    this.degradations.push({ table, rowId, reason, detail })
  }

  build(): MaterializationSummary {
    return {
      activeJobsDeleted: this.activeJobsDeleted,
      schedulesDisabled: this.schedulesDisabled,
      mcpServersSanitized: this.mcpServersSanitized,
      agentsSanitized: this.agentsSanitized,
      channelsSanitized: this.channelsSanitized,
      knowledgeItemsReset: this.knowledgeItemsReset,
      externalFileEntriesDeleted: this.externalFileEntriesDeleted,
      preferencesDeleted: this.preferencesDeleted,
      codeCliConfigsRewritten: this.codeCliConfigsRewritten,
      codeCliConfigsDeleted: this.codeCliConfigsDeleted,
      pathsRebased: this.pathsRebased,
      pathsExternal: this.pathsExternal,
      degradations: this.degradations
    }
  }
}

/**
 * Drop runtime work that would execute on the target.
 *
 * Expressed as SQL over the job domain's own status constants so a status added
 * upstream is classified here too: an ACTIVE status is dispatched at startup, and
 * an UNRECOGNIZED one cannot be proven terminal, so both go. Terminal rows are
 * inert history and stay.
 */
function resetJobs(db: DbOrTx, summary: SummaryBuilder): void {
  summary.activeJobsDeleted = db
    .delete(jobTable)
    .where(
      or(
        inArray(jobTable.status, [...ACTIVE_JOB_STATUSES]),
        notInArray(jobTable.status, [...JobStatusAtomSchema.options])
      )
    )
    .run().changes

  summary.schedulesDisabled = db
    .update(jobScheduleTable)
    .set({ ...JOB_SCHEDULE_AUTOMATION_PATCH, updatedAt: preserveUpdatedAt(jobScheduleTable.updatedAt) })
    .where(eq(jobScheduleTable.enabled, true))
    .run().changes
}

function resetMcpServers(db: DbOrTx, summary: SummaryBuilder): void {
  const rows = db
    .select({
      id: mcpServerTable.id,
      args: jsonTextOf(mcpServerTable.args),
      env: jsonTextOf(mcpServerTable.env),
      headers: jsonTextOf(mcpServerTable.headers),
      configSample: jsonTextOf(mcpServerTable.configSample),
      disabledTools: jsonTextOf(mcpServerTable.disabledTools),
      disabledAutoApproveTools: jsonTextOf(mcpServerTable.disabledAutoApproveTools)
    })
    .from(mcpServerTable)
    .all()

  for (const row of rows) {
    const { patch, malformedFields } = sanitizeMcpServerCapability({
      args: decodeJsonColumn(row.args),
      env: decodeJsonColumn(row.env),
      headers: decodeJsonColumn(row.headers),
      configSample: decodeJsonColumn(row.configSample),
      disabledTools: decodeJsonColumn(row.disabledTools),
      disabledAutoApproveTools: decodeJsonColumn(row.disabledAutoApproveTools)
    })
    db.update(mcpServerTable)
      .set({ ...patch, updatedAt: preserveUpdatedAt(mcpServerTable.updatedAt) })
      .where(eq(mcpServerTable.id, row.id))
      .run()
    if (malformedFields.length > 0) {
      summary.degrade('mcp_server', row.id, 'capability-malformed', malformedFields.join(','))
    }
  }
  summary.mcpServersSanitized = rows.length
}

function resetAgents(db: DbOrTx, summary: SummaryBuilder): void {
  const rows = db
    .select({ id: agentTable.id, configuration: jsonTextOf(agentTable.configuration) })
    .from(agentTable)
    .all()

  for (const row of rows) {
    const { patch, malformedFields } = sanitizeAgentAutomation(decodeJsonColumn(row.configuration))
    db.update(agentTable)
      .set({ ...patch, updatedAt: preserveUpdatedAt(agentTable.updatedAt) })
      .where(eq(agentTable.id, row.id))
      .run()
    if (malformedFields.length > 0) {
      summary.degrade('agent', row.id, 'capability-malformed', malformedFields.join(','))
    }
  }
  summary.agentsSanitized = rows.length
}

function resetAgentChannels(db: DbOrTx, summary: SummaryBuilder): void {
  const rows = db
    .select({
      id: agentChannelTable.id,
      type: agentChannelTable.type,
      config: jsonTextOf(agentChannelTable.config),
      permissionMode: agentChannelTable.permissionMode
    })
    .from(agentChannelTable)
    .all()

  for (const row of rows) {
    const { patch, malformedFields } = sanitizeAgentChannelCapability({
      type: row.type,
      config: decodeJsonColumn(row.config),
      permissionMode: row.permissionMode
    })
    db.update(agentChannelTable)
      .set({
        ...patch,
        updatedAt: preserveUpdatedAt(agentChannelTable.updatedAt)
      })
      .where(eq(agentChannelTable.id, row.id))
      .run()
    if (malformedFields.length > 0) {
      summary.degrade('agent_channel', row.id, 'capability-malformed', malformedFields.join(','))
    }
  }
  summary.channelsSanitized = rows.length
}

/**
 * Rewrite the knowledge-item statuses that auto-execute on the target, driving
 * the UPDATEs from the pure policy function so the executable set is declared in
 * exactly one place.
 */
function resetKnowledgeItems(db: DbOrTx, summary: SummaryBuilder): void {
  for (const status of KNOWLEDGE_ITEM_STATUSES) {
    const reset = resetKnowledgeItemStatus(status)
    if (reset === null) continue
    summary.knowledgeItemsReset += db
      .update(knowledgeItemTable)
      .set({
        status: reset.status,
        // Written together with the status: `knowledge_item_status_error_check`
        // rejects `failed` without a non-blank error.
        error: reset.error,
        updatedAt: preserveUpdatedAt(knowledgeItemTable.updatedAt)
      })
      .where(eq(knowledgeItemTable.status, status))
      .run().changes
  }
}

/**
 * Delete device-bound preference rows so the TARGET build's default applies, then
 * perform the one partial reset: `feature.code_cli.configs` keeps its providers
 * and models while losing the device-local fields.
 */
function resetPreferences(db: DbOrTx, summary: SummaryBuilder): void {
  summary.preferencesDeleted = db
    .delete(preferenceTable)
    .where(inArray(preferenceTable.key, [...PREFERENCE_RESET_KEYS]))
    .run().changes

  // The primary key is (scope, key), so the key can legitimately appear once per scope.
  const rows = db
    .select({ scope: preferenceTable.scope, value: jsonTextOf(preferenceTable.value) })
    .from(preferenceTable)
    .where(eq(preferenceTable.key, CODE_CLI_CONFIGS_KEY))
    .all()

  for (const row of rows) {
    const rowFilter = and(eq(preferenceTable.scope, row.scope), eq(preferenceTable.key, CODE_CLI_CONFIGS_KEY))
    const decision = sanitizeCodeCliConfigs(decodeJsonColumn(row.value))
    if (decision.kind === 'delete') {
      db.delete(preferenceTable).where(rowFilter).run()
      summary.codeCliConfigsDeleted += 1
      continue
    }
    if (decision.strippedTools.length === 0) continue
    db.update(preferenceTable)
      .set({ value: decision.value, updatedAt: preserveUpdatedAt(preferenceTable.updatedAt) })
      .where(rowFilter)
      .run()
    summary.codeCliConfigsRewritten += 1
  }
}

/**
 * Rebase `note.root_path`. The unique key is (root_path, path), and `path` is
 * already root-relative so it is never rewritten. Classification is cached per
 * distinct root because every row under one root shares its verdict.
 */
function rebaseNotes(db: DbOrTx, table: ManagedRootRebaseTable, summary: SummaryBuilder): void {
  const rows = db.select({ id: noteTable.id, rootPath: noteTable.rootPath, path: noteTable.path }).from(noteTable).all()
  const verdicts = new Map<string, ReturnType<typeof classifyManagedPath>>()

  const candidates: RebaseCandidate<{ rootPath: string }>[] = []
  for (const row of rows) {
    let verdict = verdicts.get(row.rootPath)
    if (verdict === undefined) {
      verdict = classifyManagedPath(table, row.rootPath)
      verdicts.set(row.rootPath, verdict)
    }

    if (verdict.kind === 'rejected') {
      summary.degrade('note', row.id, 'path-unportable', verdict.reason)
      continue
    }
    if (verdict.kind === 'external') {
      summary.pathsExternal += 1
      // Reserve the key so a rebase cannot land on this row's (root_path, path).
      candidates.push({
        id: row.id,
        currentKey: noteKey(row.rootPath, row.path),
        nextKey: null,
        write: { rootPath: row.rootPath }
      })
      continue
    }
    candidates.push({
      id: row.id,
      currentKey: noteKey(row.rootPath, row.path),
      nextKey: noteKey(verdict.rebasedPath, row.path),
      write: { rootPath: verdict.rebasedPath }
    })
  }

  const { applied, collided } = resolveRebaseWrites(candidates)
  for (const { id, write } of applied) {
    db.update(noteTable)
      .set({ rootPath: write.rootPath, updatedAt: preserveUpdatedAt(noteTable.updatedAt) })
      .where(eq(noteTable.id, id))
      .run()
  }
  summary.pathsRebased += applied.length
  for (const id of collided) summary.degrade('note', id, 'path-collision')
}

function noteKey(rootPath: string, path: string): string {
  return `${rootPath}\u0000${path}`
}

/**
 * Rebase `agent_workspace.path` (unique on `path`). A SYSTEM workspace is built
 * under the managed workspaces root, so it rebases; anything else — a
 * user-chosen location on the source device, an unportable value, or a rebase
 * that lost its unique key — is DISCONNECTED: the row keeps its sessions but its
 * path is replaced by a unique, non-existent path under this device's workspaces
 * root (§4).
 *
 * Disconnecting rather than keeping the value inert is what makes "never followed"
 * true by construction instead of by review: the Agents page stats a workspace
 * path the moment it mounts, so an archive-controlled string surviving here is a
 * zero-interaction reach (a `\\server\share` path leaks credentials on Windows).
 * Clearing the column is not available — it is NOT NULL and unique — and deleting
 * the row would cascade its sessions and messages away, so a placeholder is the
 * only shape that keeps the user's history and denies the reach at once.
 */
function rebaseAgentWorkspaces(db: DbOrTx, table: ManagedRootRebaseTable, summary: SummaryBuilder): void {
  const rows = db.select({ id: agentWorkspaceTable.id, path: agentWorkspaceTable.path }).from(agentWorkspaceTable).all()

  const candidates: RebaseCandidate<{ path: string }>[] = []
  const disconnect = new Set<string>()
  for (const row of rows) {
    const verdict = classifyManagedPath(table, row.path)
    if (verdict.kind !== 'managed') {
      if (verdict.kind === 'rejected') summary.degrade('agent_workspace', row.id, 'path-unportable', verdict.reason)
      else summary.pathsExternal += 1
      disconnect.add(row.id)
      // Reserve the key anyway: until this row's placeholder is written it still
      // owns its stored path, so no rebase may plan to land on it.
      candidates.push({ id: row.id, currentKey: row.path, nextKey: null, write: { path: row.path } })
      continue
    }
    candidates.push({
      id: row.id,
      currentKey: row.path,
      nextKey: verdict.rebasedPath,
      write: { path: verdict.rebasedPath }
    })
  }

  const { applied, collided } = resolveRebaseWrites(candidates)
  for (const { id, write } of applied) {
    db.update(agentWorkspaceTable)
      .set({ path: write.path, updatedAt: preserveUpdatedAt(agentWorkspaceTable.updatedAt) })
      .where(eq(agentWorkspaceTable.id, id))
      .run()
  }
  summary.pathsRebased += applied.length
  for (const id of collided) {
    summary.degrade('agent_workspace', id, 'path-collision')
    disconnect.add(id)
  }

  disconnectAgentWorkspaces(db, table, summary, rows, disconnect)
}

/**
 * Give every disconnected workspace a placeholder no other row can hold.
 *
 * Every path in the table — the ones just rebased and the stored ones about to be
 * replaced — is taken as occupied, so a crafted archive that stores a path inside
 * {@link DISCONNECTED_AGENT_WORKSPACE_DIRECTORY} can neither collide with a placeholder nor
 * make an intermediate `UPDATE` violate the unique index; it only pushes the
 * suffix along. Ids are processed in sorted order, so the same archive always
 * produces the same placeholders.
 */
function disconnectAgentWorkspaces(
  db: DbOrTx,
  table: ManagedRootRebaseTable,
  summary: SummaryBuilder,
  rows: readonly { id: string; path: string }[],
  disconnect: ReadonlySet<string>
): void {
  if (disconnect.size === 0) return

  const taken = new Set(rows.map((row) => row.path))
  const rebased = db.select({ path: agentWorkspaceTable.path }).from(agentWorkspaceTable).all()
  for (const row of rebased) taken.add(row.path)

  const placeholder = (segment: string, attempt: number): string => {
    const unique = attempt === 0 ? segment : `${segment}-${attempt}`
    const path = targetLocalPath(table, 'feature.agents.system_workspaces', [
      DISCONNECTED_AGENT_WORKSPACE_DIRECTORY,
      unique
    ])
    if (path === null) {
      // The workspaces root is paired for every restore (prepareManagedRootRebase
      // fails closed otherwise) and these segments are ASCII by construction, so
      // this is unreachable — and if it ever happens, keeping the archive's path
      // is the one outcome that must not follow.
      throw new Error('cannot build a local placeholder for a disconnected agent workspace')
    }
    return path
  }

  for (const id of [...disconnect].sort()) {
    const segment = toDisconnectedAgentWorkspaceSegment(id)
    let path = placeholder(segment, 0)
    for (let attempt = 1; taken.has(path); attempt++) path = placeholder(segment, attempt)
    taken.add(path)
    db.update(agentWorkspaceTable)
      .set({ path, updatedAt: preserveUpdatedAt(agentWorkspaceTable.updatedAt) })
      .where(eq(agentWorkspaceTable.id, id))
      .run()
    summary.degrade('agent_workspace', id, 'workspace-disconnected')
  }
}

/**
 * The whole policy, in one transaction.
 *
 * NOTE for future policy additions: no statement here may touch `message` or
 * `agent_session_message`. Their FTS5 sync triggers cannot run under
 * `trusted_schema = OFF` (fts5 is not an "innocuous" virtual table), which is the
 * setting that makes an untrusted archive schema safe to open. Those two tables'
 * external-content indexes are keyed on a stable `fts_rowid` column precisely so
 * they survive `VACUUM INTO` transport, so there is nothing to rebuild.
 */
function dropExternalFileEntries(db: DbOrTx, summary: SummaryBuilder): void {
  const rows = db
    .select({ id: fileEntryTable.id })
    .from(fileEntryTable)
    .where(eq(fileEntryTable.origin, 'external'))
    .all()
  if (rows.length === 0) return

  summary.externalFileEntriesDeleted = db
    .delete(fileEntryTable)
    .where(eq(fileEntryTable.origin, 'external'))
    .run().changes
  for (const row of rows) summary.degrade('file_entry', row.id, 'external-file-dropped')
}

function applyPolicy(db: DbOrTx, mode: MaterializeMode): MaterializationSummary {
  const summary = new SummaryBuilder()
  resetJobs(db, summary)
  dropExternalFileEntries(db, summary)
  resetMcpServers(db, summary)
  resetAgents(db, summary)
  resetAgentChannels(db, summary)
  resetKnowledgeItems(db, summary)
  resetPreferences(db, summary)
  if (mode.kind === 'restore') {
    rebaseNotes(db, mode.rebase, summary)
    rebaseAgentWorkspaces(db, mode.rebase, summary)
  }
  return summary.build()
}

function chainsEqual(a: readonly AppliedMigration[], b: readonly AppliedMigration[]): boolean {
  return (
    a.length === b.length && a.every((item, i) => item.folderMillis === b[i].folderMillis && item.hash === b[i].hash)
  )
}

/**
 * Apply the portable-database policy to the detached file at `inputs.dbPath`,
 * then seal and hash it.
 *
 * Throws without changing a row if the policy fails part-way: every write is in
 * one transaction, and the migration chain is re-read afterwards so a policy that
 * ever disturbed `__drizzle_migrations` (which would trigger a reseed or a v1
 * replay on the target) fails loudly instead of shipping.
 */
export async function materializePortableDatabase(inputs: MaterializeInputs): Promise<MaterializedDatabase> {
  if (inputs.signal?.aborted) throw new BackupCancelledError()

  const sqlite = new Database(inputs.dbPath, { fileMustExist: true })
  let summary: MaterializationSummary
  let chain: readonly AppliedMigration[]
  try {
    // The restore side opens an attacker-supplied schema; SQLite's own boundary
    // for that is trusted_schema=OFF. Set unconditionally so both sides execute
    // under identical, testable constraints.
    sqlite.pragma('trusted_schema = OFF')
    assertDbIntegrity(sqlite, 'pre')

    const chainBefore = readAppliedChain(sqlite)
    const db = drizzle({ client: sqlite, casing: 'snake_case' })
    summary = db.transaction((tx) => applyPolicy(tx, inputs.mode))

    chain = readAppliedChain(sqlite)
    if (!chainsEqual(chainBefore, chain)) {
      throw new Error('materializePortableDatabase: policy changed the applied migration chain')
    }
    assertDbIntegrity(sqlite, 'post')
    sealDetachedDb(sqlite)
  } finally {
    sqlite.close()
  }

  assertNoDbSidecars(inputs.dbPath)
  const hash = await sha256FileCancellable(inputs.dbPath, inputs.signal)
  const sizeBytes = (await stat(inputs.dbPath)).size
  return { summary, hash, sizeBytes, chain }
}
