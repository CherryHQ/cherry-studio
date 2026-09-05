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
import { AGENT_RUNTIME_CAPABILITIES } from '@shared/ai/agentRuntimeCapabilities'
import { AGENT_WORKSPACE_TYPE } from '@shared/data/api/schemas/agentWorkspaces'
import { type Trigger, triggersEqual } from '@shared/data/api/schemas/jobs'

import { agentDataDirectoryPath } from './agentDataDirectory'
import { ensureHeartbeatFile } from './heartbeat'

const logger = loggerService.withContext('HeartbeatSchedule')

const AGENT_TASK_TYPE = 'agent.task' as const

/** Same default as user tasks (`DEFAULT_TIMEOUT_MINUTES` in AgentJobsService). */
const HEARTBEAT_TIMEOUT_MINUTES = 2

/** Mirrors the renderer form default (`DEFAULT_HEARTBEAT_INTERVAL`). */
export const DEFAULT_HEARTBEAT_INTERVAL_MINUTES = 30

/** Mirrors the renderer form clamp (InputNumber max in AgentEditDialog). */
const MAX_HEARTBEAT_INTERVAL_MINUTES = 1440

export type HeartbeatSyncOutcome =
  | 'created'
  | 'updated'
  | 'paused'
  | 'noop'
  | 'skipped-disabled'
  | 'skipped-capability'
  | 'skipped-missing-agent'

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
  return Math.min(Math.round(raw), MAX_HEARTBEAT_INTERVAL_MINUTES)
}

/** A row is this agent's heartbeat iff its template carries the sentinel prompt. */
function isHeartbeatRow(row: { jobInputTemplate: unknown }, agentId: string): boolean {
  if (typeof row.jobInputTemplate !== 'object' || row.jobInputTemplate === null) return false
  const template = row.jobInputTemplate as { agentId?: unknown; prompt?: unknown }
  return template.agentId === agentId && template.prompt === HEARTBEAT_PROMPT_SENTINEL
}

function findHeartbeatRow(agentId: string) {
  return jobScheduleService.listAll({ type: AGENT_TASK_TYPE }).find((row) => isHeartbeatRow(row, agentId)) ?? null
}

/** True when the stored template no longer matches what sync would write. */
function templateDrifted(current: unknown, target: HeartbeatJobInputTemplate): boolean {
  if (typeof current !== 'object' || current === null) return true
  const template = current as { timeoutMinutes?: unknown; workspace?: unknown }
  if (template.timeoutMinutes !== target.timeoutMinutes) return true
  const workspace = template.workspace as { type?: unknown; workspaceId?: unknown } | null
  if (typeof workspace !== 'object' || workspace === null) return true
  return workspace.type !== target.workspace.type || workspace.workspaceId !== target.workspace.workspaceId
}

/**
 * Converge the agent's heartbeat schedule with its configuration. Safe to
 * call repeatedly and from any context (event handlers, startup, agent
 * creation); every failure path is the caller's to log, never a user-facing
 * error — the v1 handler had the same contract.
 */
export async function syncHeartbeatSchedule(agentId: string): Promise<HeartbeatSyncOutcome> {
  const agent = agentService.getAgent(agentId)
  if (!agent) return 'skipped-missing-agent'

  // The heartbeat switch only renders for runtimes that support it; honor
  // the same capability here so a schedule is never armed for, say, dsh.
  if (AGENT_RUNTIME_CAPABILITIES[agent.type]?.heartbeat !== true) return 'skipped-capability'

  const config = agent.configuration ?? {}

  if (config.heartbeat_enabled === false) {
    // Pause instead of delete: zero timer ticks while off, no churn on re-enable.
    // The run-side gate remains as a backstop for rows paused by neither path.
    const existing = findHeartbeatRow(agentId)
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
  const workspacePath = agentDataDirectoryPath(application.getPath('feature.agents.data'), agentId)
  await ensureHeartbeatFile(workspacePath)
  const workspace = agentWorkspaceService.findOrCreateByPath(workspacePath, {
    name: `Heartbeat — ${agent.name}`
  })
  const trigger: Trigger = { kind: 'interval', ms: intervalMinutes * 60_000 }
  const jobInputTemplate: HeartbeatJobInputTemplate = {
    agentId,
    prompt: HEARTBEAT_PROMPT_SENTINEL,
    timeoutMinutes: HEARTBEAT_TIMEOUT_MINUTES,
    workspace: { type: AGENT_WORKSPACE_TYPE.USER, workspaceId: workspace.id },
    reuseRevision: 0
  }

  const existing = findHeartbeatRow(agentId)
  const jobManager = application.get('JobManager')

  if (!existing) {
    const { id } = application.get('DbService').withWriteTx((tx) =>
      jobManager.registerJobScheduleTx(tx, {
        type: AGENT_TASK_TYPE,
        // Per-agent name: (type, name) is UNIQUE, so a shared literal would
        // limit heartbeats to a single agent across the whole installation.
        name: `heartbeat_${agentId}`,
        trigger,
        jobInputTemplate,
        catchUpPolicy: { kind: 'skip-missed' }
      })
    )
    jobManager.syncJobScheduleTimerById(id)
    logger.info('Heartbeat schedule created', { agentId, scheduleId: id, intervalMinutes })
    return 'created'
  }

  // Repair in place, preserving the schedule name (renaming a migrated row
  // could collide with the UNIQUE index and breaks no behavior that reads it).
  const triggerChanged = !triggersEqual(existing.trigger, trigger)
  const needsRepair =
    !existing.enabled || triggerChanged || templateDrifted(existing.jobInputTemplate, jobInputTemplate)
  if (!needsRepair) return 'noop'

  application.get('DbService').withWriteTx((tx) => {
    jobManager.updateJobScheduleTx(tx, existing.id, {
      ...(!existing.enabled ? { enabled: true } : {}),
      ...(triggerChanged ? { trigger } : {}),
      jobInputTemplate
    })
  })
  jobManager.syncJobScheduleTimerById(existing.id)
  logger.info('Heartbeat schedule repaired', { agentId, scheduleId: existing.id, intervalMinutes })
  return 'updated'
}

/**
 * Startup pass: converge every agent's heartbeat once. Repairs v1-migrated
 * rows (whose system workspace can never fire) and provisions rows for
 * agents created while the producer was missing (#19203). Per-agent failures
 * are isolated — one broken agent must not block the rest.
 */
export async function repairHeartbeatSchedules(): Promise<void> {
  const { agents } = agentService.listAgents()
  const counts = new Map<HeartbeatSyncOutcome | 'failed', number>()
  for (const agent of agents) {
    try {
      const outcome = await syncHeartbeatSchedule(agent.id)
      counts.set(outcome, (counts.get(outcome) ?? 0) + 1)
    } catch (error) {
      counts.set('failed', (counts.get('failed') ?? 0) + 1)
      logger.warn('Heartbeat sync failed at startup', { agentId: agent.id, error })
    }
  }
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
