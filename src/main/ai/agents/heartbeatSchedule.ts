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
import { HEARTBEAT_PROMPT_SENTINEL } from '@data/services/AgentTaskService'
import { agentWorkspaceService } from '@data/services/AgentWorkspaceService'
import { jobScheduleService } from '@data/services/JobScheduleService'
import { loggerService } from '@logger'
import {
  DEFAULT_HEARTBEAT_INTERVAL_MINUTES,
  MAX_HEARTBEAT_INTERVAL_MINUTES,
  MIN_HEARTBEAT_INTERVAL_MINUTES
} from '@shared/ai/agentHeartbeat'
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

/** Zero/negative/non-numeric means "unset", not "as fast as possible" — default. */
function clampIntervalMinutes(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) {
    return DEFAULT_HEARTBEAT_INTERVAL_MINUTES
  }
  // A bare Math.round could land on 0 (e.g. 0.4) and arm a 0ms trigger.
  return Math.min(Math.max(MIN_HEARTBEAT_INTERVAL_MINUTES, Math.round(raw)), MAX_HEARTBEAT_INTERVAL_MINUTES)
}

/** A row is this agent's heartbeat iff its template carries the sentinel prompt. */
function isHeartbeatRow(row: { jobInputTemplate: unknown }, agentId: string): boolean {
  if (typeof row.jobInputTemplate !== 'object' || row.jobInputTemplate === null) return false
  const template = row.jobInputTemplate as { agentId?: unknown; prompt?: unknown }
  return template.agentId === agentId && template.prompt === HEARTBEAT_PROMPT_SENTINEL
}

function findHeartbeatRow(agentId: string, rows: JobScheduleSnapshot[]) {
  return (
    rows.find((row) => isHeartbeatRow(row, agentId)) ??
    // Self-heal fallback: whitespace-corrupted sentinel still identified by
    // reserved name + agentId. Free-text prompt = user task — never rewrite.
    rows.find((row) => {
      if (row.name !== `heartbeat_${agentId}`) return false
      const template = row.jobInputTemplate as { agentId?: unknown; prompt?: unknown } | null
      if (template?.agentId !== agentId) return false
      return typeof template.prompt !== 'string' || template.prompt.trim() === HEARTBEAT_PROMPT_SENTINEL
    }) ??
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
  return current
}

async function runSync(
  agentId: string,
  rows: JobScheduleSnapshot[] = jobScheduleService.listAll({ type: AGENT_TASK_TYPE })
): Promise<HeartbeatSyncOutcome> {
  const agent = agentService.getAgent(agentId)
  if (!agent) return 'skipped-missing-agent'

  if (!(agent.type in AGENT_RUNTIME_CAPABILITIES)) {
    // Corrupted/legacy/future runtime: without this warn the heartbeat is
    // silently never armed even though the config save succeeded.
    logger.warn('Agent runtime missing from the capabilities table; heartbeat not armed', {
      agentId,
      type: agent.type
    })
    return 'skipped-capability'
  }

  // The heartbeat switch only renders for runtimes that support it; honor
  // the same capability here so a schedule is never armed for, say, dsh.
  if (AGENT_RUNTIME_CAPABILITIES[agent.type]?.heartbeat !== true) return 'skipped-capability'

  const config = agent.configuration ?? {}

  if (config.heartbeat_enabled === false) {
    // Pause instead of delete: zero timer ticks while off, no churn on re-enable.
    // The run-side gate remains as a backstop for rows paused by neither path.
    const existing = findHeartbeatRow(agentId, rows)
    if (existing?.enabled) {
      application.get('DbService').withWriteTx((tx) => {
        application.get('JobManager').updateJobScheduleTx(tx, existing.id, { enabled: false })
      })
      application.get('JobManager').syncJobScheduleTimerById(existing.id)
      logger.info('Heartbeat schedule paused', { agentId, scheduleId: existing.id })
      return 'paused'
    }
    return 'skipped-disabled'
  }

  const intervalMinutes = clampIntervalMinutes(config.heartbeat_interval)

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
  const workspace = agentWorkspaceService.findOrCreateByPath(workspacePath, {
    name: `Heartbeat — ${agent.name}`
  })
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
    const triggerChanged = !triggersEqual(row.trigger, trigger)
    const needsRepair = !row.enabled || triggerChanged || templateDrifted(row.jobInputTemplate, jobInputTemplate)
    if (!needsRepair) return 'noop'

    application.get('DbService').withWriteTx((tx) => {
      jobManager.updateJobScheduleTx(tx, row.id, {
        ...(!row.enabled ? { enabled: true } : {}),
        ...(triggerChanged ? { trigger } : {}),
        jobInputTemplate
      })
    })
    jobManager.syncJobScheduleTimerById(row.id)
    logger.info('Heartbeat schedule repaired', { agentId, scheduleId: row.id, intervalMinutes })
    return 'updated'
  }

  const existing = findHeartbeatRow(agentId, rows)
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
      logger.info('Heartbeat schedule created', { agentId, scheduleId: id, intervalMinutes })
      return 'created'
    } catch (error) {
      const winner = jobScheduleService.getByTypeAndName(AGENT_TASK_TYPE, scheduleName)
      // Benign only when the (type, name) winner is this agent's heartbeat
      // row — a foreign row sharing the reserved name must stay untouched.
      if (!isScheduleNameConflict(error) || !winner || !isHeartbeatRow(winner, agentId)) throw error
      logger.info('Heartbeat create raced a concurrent sync; repairing winner', {
        agentId,
        scheduleId: winner.id
      })
      return repairRow(winner)
    }
  }

  return repairRow(existing)
}

/**
 * Startup pass: converge every agent's heartbeat once. Repairs v1-migrated
 * rows (whose system workspace can never fire) and provisions rows for
 * agents created while the producer was missing (#19203). Per-agent failures
 * are isolated — one broken agent must not block the rest.
 */
export async function repairHeartbeatSchedules(): Promise<void> {
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
