/**
 * Configuration → schedule translation for the agent heartbeat — restores the
 * producer v1 had (`SchedulerService.ensureHeartbeatTask`) and the JobManager
 * migration dropped (#19203). Identity is the `__heartbeat__` sentinel prompt
 * plus template agentId, never the schedule name (the v1→v2 migration may
 * have disambiguated it — see #19568). The heartbeat session runs in a user
 * workspace over the agent data directory, where `heartbeat.md` lives beside
 * SOUL.md/USER.md; migrated rows point at a system workspace, which the run
 * side rejects, so sync repairs them in place. While `heartbeat.md` holds
 * only the comments-only template (or is missing), the run side skips the
 * model call — an enabled-by-default heartbeat stays quiet until the user
 * writes a checklist.
 */

import { application } from '@application'
import { agentService } from '@data/services/AgentService'
import {
  HEARTBEAT_PROMPT_SENTINEL,
  isCircuitBreakerPaused,
  writeCircuitBreakerPaused
} from '@data/services/AgentTaskService'
import { agentWorkspaceService } from '@data/services/AgentWorkspaceService'
import { jobScheduleService } from '@data/services/JobScheduleService'
import { loggerService } from '@logger'
import { clampHeartbeatIntervalMinutes } from '@shared/ai/agentHeartbeat'
import { AGENT_RUNTIME_CAPABILITIES } from '@shared/ai/agentRuntimeCapabilities'
import { DataApiError, ErrorCode } from '@shared/data/api/errors'
import { AGENT_WORKSPACE_TYPE } from '@shared/data/api/schemas/agentWorkspaces'
import { JOB_ERROR_CODES, type JobScheduleSnapshot, type Trigger, triggersEqual } from '@shared/data/api/schemas/jobs'

import { agentDataDirectoryPath, assertAgentStoragePath } from './agentDataDirectory'
import { DEFAULT_AGENT_TASK_TIMEOUT_MINUTES } from './agentTaskDefaults'
import { ensureHeartbeatFile } from './heartbeat'

const logger = loggerService.withContext('HeartbeatSchedule')

const AGENT_TASK_TYPE = 'agent.task' as const

export type HeartbeatSyncOutcome =
  | 'created'
  | 'updated'
  | 'paused'
  | 'noop'
  | 'skipped-disabled'
  | 'skipped-capability'
  | 'skipped-missing-agent'
  | 'skipped-untrusted-path'

type HeartbeatJobInputTemplate = {
  agentId: string
  prompt: string
  timeoutMinutes: number
  workspace: { type: 'user'; workspaceId: string }
  reuseRevision: number
}

/** A row is this agent's heartbeat iff its template carries the sentinel prompt. */
function isHeartbeatRow(row: { jobInputTemplate: unknown }, agentId: string): boolean {
  if (typeof row.jobInputTemplate !== 'object' || row.jobInputTemplate === null) return false
  const template = row.jobInputTemplate as { agentId?: unknown; prompt?: unknown }
  return template.agentId === agentId && template.prompt === HEARTBEAT_PROMPT_SENTINEL
}

/** Self-heal identity: whitespace-corrupted sentinel + reserved name + agentId. */
function matchesFallbackIdentity(row: JobScheduleSnapshot, agentId: string): boolean {
  // Free-text prompt = user task on the reserved name — never rewrite it.
  if (row.name !== `heartbeat_${agentId}`) return false
  const template = row.jobInputTemplate as { agentId?: unknown; prompt?: unknown } | null
  if (template?.agentId !== agentId) return false
  return typeof template.prompt !== 'string' || template.prompt.trim() === HEARTBEAT_PROMPT_SENTINEL
}

/** Heartbeat identity by sentinel prompt, or the corrupted-sentinel fallback. */
function matchesHeartbeatIdentity(row: JobScheduleSnapshot, agentId: string): boolean {
  return isHeartbeatRow(row, agentId) || matchesFallbackIdentity(row, agentId)
}

function findHeartbeatRow(agentId: string, rows: JobScheduleSnapshot[]) {
  return (
    rows.find((row) => isHeartbeatRow(row, agentId)) ??
    rows.find((row) => matchesFallbackIdentity(row, agentId)) ??
    null
  )
}

/** True when the error is the (type, name) UNIQUE-conflict from registerJobScheduleTx. */
function isScheduleNameConflict(error: unknown): boolean {
  const prefix = JOB_ERROR_CODES.SCHEDULE_NAME_CONFLICT
  if (error instanceof DataApiError) {
    return error.code === ErrorCode.CONFLICT && error.message.startsWith(prefix)
  }
  const message = error instanceof Error ? error.message : String(error)
  return message.startsWith(prefix)
}

/** True when the stored template no longer matches what sync would write. */
function templateDrifted(current: unknown, target: HeartbeatJobInputTemplate): boolean {
  if (typeof current !== 'object' || current === null) return true
  const template = current as {
    agentId?: unknown
    prompt?: unknown
    timeoutMinutes?: unknown
    reuseRevision?: unknown
    workspace?: unknown
  }
  if (template.agentId !== target.agentId || template.prompt !== target.prompt) return true
  if (template.timeoutMinutes !== target.timeoutMinutes) return true
  // reuseRevision is read at run time, so drift there must not report 'noop'.
  if (template.reuseRevision !== target.reuseRevision) return true
  const workspace = template.workspace as { type?: unknown; workspaceId?: unknown } | null
  if (typeof workspace !== 'object' || workspace === null) return true
  return workspace.type !== target.workspace.type || workspace.workspaceId !== target.workspace.workspaceId
}

// Per-agent sync chains — the serialization behind the export below.
const syncChains = new Map<string, Promise<HeartbeatSyncOutcome>>()

// All unsettled heartbeat work, tracked at module level so the lifecycle
// drain covers every caller (AgentJobsService, createAgent), not just one.
const inFlightWork = new Set<Promise<unknown>>()

function trackWork<T>(work: Promise<T>): Promise<T> {
  inFlightWork.add(work)
  const done = () => inFlightWork.delete(work)
  void work.then(done, done)
  return work
}

/** Wait out all in-flight heartbeat work; loops since settling work can enqueue follow-ups. */
export async function drainHeartbeatWork(): Promise<void> {
  while (inFlightWork.size > 0) {
    await Promise.allSettled([...inFlightWork])
  }
}

/**
 * Converge the agent's heartbeat schedule with its configuration. Safe to
 * call repeatedly and from any context (event handlers, startup, agent
 * creation); every failure path is the caller's to log, never a user-facing
 * error — the v1 handler had the same contract.
 *
 * Same-agent calls are serialized: each sync reads the configuration at
 * entry, so an unserialized pair (config-save racing the startup pass) could
 * commit a stale read over a fresher one. The last entrant commits last.
 */
export function syncHeartbeatSchedule(agentId: string, rows?: JobScheduleSnapshot[]): Promise<HeartbeatSyncOutcome> {
  const previous = syncChains.get(agentId) ?? Promise.resolve()
  const current = previous.catch(() => undefined).then(() => runSync(agentId, rows))
  syncChains.set(agentId, current)
  const settled = () => {
    if (syncChains.get(agentId) === current) syncChains.delete(agentId)
  }
  current.then(settled, settled)
  return trackWork(current)
}

/** Pause (never delete) every enabled heartbeat row; returns the paused ids. */
function pauseHeartbeatRows(
  agentId: string,
  rows: JobScheduleSnapshot[],
  options: { clearBreakerMarker: boolean }
): string[] {
  // Duplicates can exist (migration disambiguation) — pausing only the first
  // identity match would leave the rest firing. Only the user's explicit
  // toggle-off clears the circuit-breaker marker (the reset gesture);
  // capability-gated pauses must keep it, or restoring the capability would
  // silently re-arm a schedule the breaker stopped.
  const paused: string[] = []
  for (const row of rows) {
    if (!matchesHeartbeatIdentity(row, agentId)) continue
    const clearMarker = options.clearBreakerMarker && isCircuitBreakerPaused(row.metadata)
    if (!row.enabled && !clearMarker) continue
    application.get('DbService').withWriteTx((tx) => {
      application.get('JobManager').updateJobScheduleTx(tx, row.id, {
        ...(row.enabled ? { enabled: false } : {}),
        ...(clearMarker ? { metadata: writeCircuitBreakerPaused(row.metadata, false) } : {})
      })
    })
    if (row.enabled) {
      application.get('JobManager').syncJobScheduleTimerById(row.id)
      paused.push(row.id)
    }
  }
  if (paused.length > 0) logger.info('Heartbeat schedule paused', { agentId, scheduleIds: paused })
  return paused
}

async function runSync(
  agentId: string,
  rows: JobScheduleSnapshot[] = jobScheduleService.listAll({ type: AGENT_TASK_TYPE })
): Promise<HeartbeatSyncOutcome> {
  const agent = agentService.getAgent(agentId)
  if (!agent) return 'skipped-missing-agent'

  // The ids of anything this sync wrote — the mid-sync deletion guard below
  // needs them to undo the writes.
  const touchedScheduleIds: string[] = []
  let createdWorkspaceId: string | null = null
  const finalize = async (outcome: HeartbeatSyncOutcome): Promise<HeartbeatSyncOutcome> => {
    // The agent could be deleted mid-sync, its onAgentDeleted schedule sweep
    // having already run — a row committed afterwards would be orphaned, as
    // would a workspace this sync created.
    if (touchedScheduleIds.length === 0 && !createdWorkspaceId) return outcome
    if (agentService.getAgent(agentId)) return outcome
    const jobManager = application.get('JobManager')
    for (const scheduleId of touchedScheduleIds) {
      await jobManager.unregisterJobScheduleById(scheduleId).catch((error) => {
        logger.warn('Failed to remove heartbeat schedule for an agent deleted mid-sync', { agentId, error })
      })
    }
    if (touchedScheduleIds.length > 0) {
      logger.info('Removed heartbeat schedule for an agent deleted mid-sync', {
        agentId,
        scheduleIds: touchedScheduleIds
      })
    }
    if (createdWorkspaceId) {
      const workspaceId = createdWorkspaceId
      application.get('DbService').withWriteTx((tx) => agentWorkspaceService.deleteByIdTx(tx, workspaceId))
    }
    return 'skipped-missing-agent'
  }

  // `in` walks the prototype chain — a type named "constructor" would pass
  // the membership test and skip the warn, silently disabling the heartbeat.
  const capabilities = Object.hasOwn(AGENT_RUNTIME_CAPABILITIES, agent.type)
    ? AGENT_RUNTIME_CAPABILITIES[agent.type]
    : undefined

  if (!capabilities) {
    // Corrupted/legacy/future runtime: without this warn the heartbeat is
    // silently never armed even though the config save succeeded.
    logger.warn('Agent runtime missing from the capabilities table; heartbeat not armed', {
      agentId,
      type: agent.type
    })
    touchedScheduleIds.push(...pauseHeartbeatRows(agentId, rows, { clearBreakerMarker: false }))
    return finalize('skipped-capability')
  }

  // The heartbeat switch only renders for runtimes that support it; honor
  // the same capability here so a schedule is never armed for, say, dsh —
  // and a capability removal pauses (never deletes) any previously-armed row.
  if (capabilities.heartbeat !== true) {
    touchedScheduleIds.push(...pauseHeartbeatRows(agentId, rows, { clearBreakerMarker: false }))
    return finalize('skipped-capability')
  }

  const config = agent.configuration ?? {}

  if (config.heartbeat_enabled === false) {
    // Pause instead of delete: zero timer ticks while off, no churn on re-enable.
    // The run-side gate remains as a backstop for rows paused by neither path.
    // An explicit toggle-off also resets a circuit-breaker stop (marker cleared).
    touchedScheduleIds.push(...pauseHeartbeatRows(agentId, rows, { clearBreakerMarker: true }))
    return finalize(touchedScheduleIds.length > 0 ? 'paused' : 'skipped-disabled')
  }

  const intervalMinutes = clampHeartbeatIntervalMinutes(config.heartbeat_interval)

  // Heartbeat sessions run in a user workspace pointing at the agent data
  // directory — the stable per-agent home where heartbeat.md lives.
  const agentsDataRoot = application.getPath('feature.agents.data')
  const workspacePath = agentDataDirectoryPath(agentsDataRoot, agentId)
  try {
    // A symlinked/tampered agent directory must not lead provisioning (or
    // the run side's heartbeat.md read) outside managed storage.
    await assertAgentStoragePath(agentsDataRoot, workspacePath)
  } catch (error) {
    logger.warn('Agent data path failed the storage check; heartbeat not armed', { agentId, workspacePath, error })
    return 'skipped-untrusted-path'
  }
  // Workspace row before the file: if this throws (a SYSTEM row owns the
  // path), no orphaned heartbeat.md is left behind to wedge future syncs.
  const { workspace, created: workspaceCreated } = agentWorkspaceService.findOrCreateByPathResult(workspacePath, {
    name: `Heartbeat — ${agent.name}`
  })
  createdWorkspaceId = workspaceCreated ? workspace.id : null
  try {
    await ensureHeartbeatFile(workspacePath)
    const trigger: Trigger = { kind: 'interval', ms: intervalMinutes * 60_000 }
    const jobInputTemplate: HeartbeatJobInputTemplate = {
      agentId,
      prompt: HEARTBEAT_PROMPT_SENTINEL,
      timeoutMinutes: DEFAULT_AGENT_TASK_TIMEOUT_MINUTES,
      workspace: { type: AGENT_WORKSPACE_TYPE.USER, workspaceId: workspace.id },
      reuseRevision: 0
    }

    const jobManager = application.get('JobManager')
    const scheduleName = `heartbeat_${agentId}`

    // The repair branch is shared by the create-race fallback below, so it is
    // factored into a local that both paths can reach.
    const repairRow = (row: JobScheduleSnapshot): HeartbeatSyncOutcome => {
      // Repair in place, preserving the schedule name (renaming a migrated row
      // could collide with the UNIQUE index and breaks no behavior that reads it).
      // A circuit-breaker pause is a stop signal, not drift: repair the row but
      // keep it disabled until the user resets via the heartbeat toggle off/on.
      const breakerPaused = !row.enabled && isCircuitBreakerPaused(row.metadata)
      const reenable = !row.enabled && !breakerPaused
      const triggerChanged = !triggersEqual(row.trigger, trigger)
      const needsRepair = reenable || triggerChanged || templateDrifted(row.jobInputTemplate, jobInputTemplate)
      if (!needsRepair) return 'noop'

      application.get('DbService').withWriteTx((tx) => {
        jobManager.updateJobScheduleTx(tx, row.id, {
          ...(reenable ? { enabled: true } : {}),
          ...(triggerChanged ? { trigger } : {}),
          jobInputTemplate
        })
      })
      // Re-arming an enabled interval resets its phase — skip the timer sync
      // when only the template changed (the armed callback re-reads the row).
      if (reenable || triggerChanged) jobManager.syncJobScheduleTimerById(row.id)
      touchedScheduleIds.push(row.id)
      if (breakerPaused) {
        logger.info('Heartbeat schedule left paused by the circuit breaker; drift repaired', {
          agentId,
          scheduleId: row.id
        })
      } else {
        logger.info('Heartbeat schedule repaired', { agentId, scheduleId: row.id, intervalMinutes })
      }
      return 'updated'
    }

    const existing = findHeartbeatRow(agentId, rows)
    // A migration-disambiguated duplicate can coexist with the canonical row
    // and both would fire — converge to one schedule per agent.
    for (const row of rows) {
      if (row.id === existing?.id || !matchesHeartbeatIdentity(row, agentId)) continue
      await jobManager.unregisterJobScheduleById(row.id)
      logger.info('Removed duplicate heartbeat schedule', { agentId, scheduleId: row.id })
    }
    if (!existing) {
      // (type, name) is UNIQUE: a concurrent sync may have registered this row
      // against a stale snapshot — a benign race, repair the winner in place.
      try {
        const { id } = application.get('DbService').withWriteTx((tx) =>
          jobManager.registerJobScheduleTx(tx, {
            type: AGENT_TASK_TYPE,
            // Per-agent name, as above — never a shared literal.
            name: scheduleName,
            trigger,
            jobInputTemplate,
            catchUpPolicy: { kind: 'skip-missed' }
          })
        )
        jobManager.syncJobScheduleTimerById(id)
        touchedScheduleIds.push(id)
        logger.info('Heartbeat schedule created', { agentId, scheduleId: id, intervalMinutes })
        return finalize('created')
      } catch (error) {
        const winner = jobScheduleService.getByTypeAndName(AGENT_TASK_TYPE, scheduleName)
        // Benign only when the (type, name) winner is this agent's heartbeat
        // row — a foreign row sharing the reserved name must stay untouched.
        if (!isScheduleNameConflict(error) || !winner || !isHeartbeatRow(winner, agentId)) throw error
        logger.info('Heartbeat create raced a concurrent sync; repairing winner', {
          agentId,
          scheduleId: winner.id
        })
        return finalize(repairRow(winner))
      }
    }

    return finalize(repairRow(existing))
  } catch (error) {
    // A workspace row created by this call is orphaned (no heartbeat row
    // points at it) when provisioning fails before the schedule commits.
    if (createdWorkspaceId && touchedScheduleIds.length === 0) {
      application.get('DbService').withWriteTx((tx) => agentWorkspaceService.deleteByIdTx(tx, createdWorkspaceId))
    }
    throw error
  }
}

/**
 * Startup pass: converge every agent's heartbeat once. Repairs v1-migrated
 * rows (whose system workspace can never fire) and provisions rows for
 * agents created while the producer was missing (#19203). Per-agent failures
 * are isolated — one broken agent must not block the rest.
 */
export function repairHeartbeatSchedules(): Promise<void> {
  return trackWork(runRepairPass())
}

async function runRepairPass(): Promise<void> {
  const { agents } = agentService.listAgents()
  // Snapshot rows once — a per-agent scan would make this O(agents × schedules).
  // Identity is per-agent, so mid-pass inserts for one agent never affect another.
  const rows = jobScheduleService.listAll({ type: AGENT_TASK_TYPE })
  const counts = new Map<HeartbeatSyncOutcome | 'failed', number>()
  // Per-agent I/O is independent — overlap it; one rejection must not block the rest.
  const results = await Promise.allSettled(agents.map((agent) => syncHeartbeatSchedule(agent.id, rows)))
  results.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      counts.set(result.value, (counts.get(result.value) ?? 0) + 1)
    } else {
      counts.set('failed', (counts.get('failed') ?? 0) + 1)
      logger.warn('Heartbeat sync failed at startup', { agentId: agents[index].id, error: result.reason })
    }
  })
  const provisioned = (counts.get('created') ?? 0) + (counts.get('updated') ?? 0)
  if (provisioned > 0) {
    logger.info('Heartbeat schedules provisioned at startup', {
      agents: agents.length,
      created: counts.get('created') ?? 0,
      updated: counts.get('updated') ?? 0,
      paused: counts.get('paused') ?? 0,
      failed: counts.get('failed') ?? 0
    })
  }
}
