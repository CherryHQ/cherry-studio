import fs from 'node:fs/promises'
import path from 'node:path'

import { application } from '@application'
import { hasPendingRestore } from '@data/db/restore/restoreJournal'
import { agentTable } from '@data/db/schemas/agent'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { agentSessionMessageService } from '@data/services/AgentSessionMessageService'
import { loggerService } from '@logger'
import { listEntries, reclaimStale } from '@main/ai/runtime/orphanSessionReclaim'
import { runtimeDriverRegistry } from '@main/ai/runtime/registry'
import type { OrphanSessionReclaimOptions } from '@main/ai/runtime/types'

const logger = loggerService.withContext('AgentOrphanSweep')

/** Per-agent dirs are named by `agent.id` (uuid v4). */
const AGENT_DIR_NAME = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Artifacts touched within this window are presumed in-flight (file-sweep parity). */
const FRESHNESS_GATE_MS = 5 * 60 * 1000

export interface AgentSweepReport {
  removed: string[]
  /** Per-runtime failures — logged, never thrown; residue is retried next run. */
  failedDrivers: string[]
}

/**
 * Orphan sweep for the app-managed agent disk state. DB rows are the single
 * source of truth (Recycle Bin RFC §4.2): an artifact survives iff a row still
 * claims it, so purging a session/agent row reclaims its residue on the next
 * run — same contract as the file orphan sweep.
 *
 * Three passes, because the layouts differ:
 *  - `{agents.data}/{agent.id}` — per-agent identity/memory dirs. They sit next
 *    to the app-owned runtime roots (`.claude`, `.pi`, `.dsh`, `system`), so
 *    only uuid-named children are ever candidates.
 *  - `{agents.system_workspaces}/{date}/{sessionId}` — app-owned session
 *    workspaces, claimed by `agent_workspace.path`. Workspace rows survive
 *    Delete and are removed at session purge.
 *  - each runtime driver's own session persistence, claimed by the resume
 *    tokens on surviving `agent_session_message` rows.
 *
 * Trashed agents/sessions keep everything: their rows (and tokens) are still
 * there, so restore stays lossless. Removal failures are logged for the next run.
 *
 * Every pass is freshness-gated: the keep-sets are one snapshot, so a dir created
 * before its claiming row commits would otherwise read as an orphan and be lost.
 */
export async function sweepAgentOrphans(signal?: AbortSignal): Promise<AgentSweepReport> {
  // Same stand-aside as the file sweeps: a staged restore puts agent dirs on disk
  // that the live DB does not claim yet — exactly what this sweep would delete.
  if (hasPendingRestore()) {
    logger.info('agent-orphan-sweep skipped — restore pending')
    return { removed: [], failedDrivers: [] }
  }

  const db = application.get('DbService').getDb()
  const options: OrphanSessionReclaimOptions = { freshnessGateMs: FRESHNESS_GATE_MS, now: Date.now() }
  const agentsRoot = application.getPath('feature.agents.data')
  const workspacesRoot = application.getPath('feature.agents.system_workspaces')

  const agentIds = new Set(
    db
      .select({ id: agentTable.id })
      .from(agentTable)
      .all()
      .map((row) => row.id)
  )
  const claimedWorkspaces = new Set(
    db
      .select({ path: agentWorkspaceTable.path })
      .from(agentWorkspaceTable)
      .all()
      .map((row) => path.resolve(row.path))
  )

  const removed: string[] = []
  let agentDirs = 0
  let workspaceDirs = 0

  for (const entry of await listEntries(agentsRoot)) {
    // Per entry: the roots can hold thousands of dirs, and a recursive rm is slow
    // enough that a cancel arriving mid-walk must not wait for the whole tree.
    signal?.throwIfAborted()
    if (!entry.isDirectory() || !AGENT_DIR_NAME.test(entry.name) || agentIds.has(entry.name)) continue
    if (await reclaim(path.resolve(agentsRoot, entry.name), removed, options)) agentDirs++
  }

  for (const dateEntry of await listEntries(workspacesRoot)) {
    if (!dateEntry.isDirectory()) continue
    const dateDir = path.resolve(workspacesRoot, dateEntry.name)
    for (const sessionEntry of await listEntries(dateDir)) {
      signal?.throwIfAborted()
      if (!sessionEntry.isDirectory()) continue
      const sessionDir = path.resolve(dateDir, sessionEntry.name)
      if (claimedWorkspaces.has(sessionDir)) continue
      if (await reclaim(sessionDir, removed, options)) workspaceDirs++
    }
    await removeIfEmpty(dateDir, removed)
  }

  signal?.throwIfAborted()
  const { runtimeSessions, failedDrivers } = await reclaimRuntimeSessions(removed, options, signal)

  logger.info('agent-orphan-sweep', { event: 'agent-orphan-sweep', agentDirs, workspaceDirs, runtimeSessions })
  return { removed, failedDrivers }
}

/**
 * Hand each runtime its own reclamation, isolated: one runtime's failure must
 * not stop the others from reclaiming. The keep-set is read once, after every
 * purge transaction has committed.
 */
async function reclaimRuntimeSessions(
  removed: string[],
  options: OrphanSessionReclaimOptions,
  signal?: AbortSignal
): Promise<{ runtimeSessions: Record<string, number>; failedDrivers: string[] }> {
  const drivers = runtimeDriverRegistry.getAgentSessionDrivers().filter((driver) => driver.reclaimOrphanSessions)
  if (drivers.length === 0) return { runtimeSessions: {}, failedDrivers: [] }

  const keptResumeTokens = agentSessionMessageService.listAllRuntimeResumeTokens()
  const runtimeSessions: Record<string, number> = {}
  const failedDrivers: string[] = []

  for (const driver of drivers) {
    signal?.throwIfAborted()
    try {
      const result = await driver.reclaimOrphanSessions!(keptResumeTokens, options)
      removed.push(...result.removed)
      runtimeSessions[driver.type] = result.removed.length
    } catch (error) {
      failedDrivers.push(driver.type)
      logger.warn('Runtime session reclaim failed — residue retried next sweep', { runtime: driver.type, error })
    }
  }

  return { runtimeSessions, failedDrivers }
}

async function reclaim(dirPath: string, removed: string[], options: OrphanSessionReclaimOptions): Promise<boolean> {
  if (!(await reclaimStale(dirPath, options))) return false
  removed.push(dirPath)
  return true
}

/** Non-recursive on purpose: ENOTEMPTY is the guard if a session repopulated the date dir mid-sweep. */
async function removeIfEmpty(dateDir: string, removed: string[]): Promise<void> {
  try {
    await fs.rmdir(dateDir)
    removed.push(dateDir)
  } catch {
    // Still in use (ENOTEMPTY) or already gone — nothing to reclaim this run.
  }
}
