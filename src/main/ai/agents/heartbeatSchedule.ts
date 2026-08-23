/**
 * Heartbeat schedule ownership — the piece the JobManager migration dropped.
 *
 * `heartbeat_enabled` / `heartbeat_interval` are agent configuration keys the
 * edit dialog writes; the run side (`runAgentTask`) still consumes them and
 * expects a `agent.task` schedule whose input template carries the heartbeat
 * prompt sentinel. Between them, nothing translated a saved configuration into
 * a schedule since the legacy `SchedulerService.ensureHeartbeatTask` was
 * deleted (#19203): the switch round-tripped in the UI while no run was ever
 * produced.
 *
 * This module restores the translation on the JobManager stack. The schedule
 * is identified by its job input template (`agentId` + prompt sentinel), not
 * by its name: `job_schedule` enforces uniqueness per (type, name), so with
 * more than one heartbeating agent the literal name `heartbeat` cannot belong
 * to everyone. The template is also what the run side and the task-listing
 * exclusion already key off.
 */

import { application } from '@application'
import { agentService } from '@data/services/AgentService'
import { agentTaskService, writeTaskSessionReuse } from '@data/services/AgentTaskService'
import { agentWorkspaceService } from '@data/services/AgentWorkspaceService'
import { jobScheduleService } from '@data/services/JobScheduleService'
import { loggerService } from '@logger'
import { triggersEqual } from '@shared/data/api/schemas/jobs'
import type { Trigger } from '@shared/data/api/schemas/jobs'

import { agentDataDirectoryPath } from './agentDataDirectory'

const logger = loggerService.withContext('HeartbeatSchedule')

export const AGENT_TASK_TYPE = 'agent.task' as const
export const HEARTBEAT_PROMPT_SENTINEL = '__heartbeat__'
export const DEFAULT_HEARTBEAT_INTERVAL_MINUTES = 30
const HEARTBEAT_TIMEOUT_MINUTES = 5

/**
 * Lower bound for `heartbeat_interval`. The schema accepts any number (0,
 * negatives) and the run side would otherwise arm an interval trigger with
 * `ms <= 0`, which the scheduler rejects or fires unstoppably.
 */
export function normalizeHeartbeatIntervalMinutes(value: number | undefined): number {
  const minutes = value ?? DEFAULT_HEARTBEAT_INTERVAL_MINUTES
  return Number.isFinite(minutes) && minutes >= 1 ? minutes : DEFAULT_HEARTBEAT_INTERVAL_MINUTES
}

function heartbeatTriggerFor(intervalMinutes: number): Trigger {
  return { kind: 'interval', ms: Math.round(intervalMinutes * 60_000) }
}

/** True when the schedule row is this agent's heartbeat, keyed off the input template. */
function isHeartbeatScheduleFor(snapshot: { jobInputTemplate: unknown }, agentId: string): boolean {
  const template = snapshot.jobInputTemplate
  if (typeof template !== 'object' || template === null) return false
  const { agentId: templateAgentId, prompt } = template as { agentId?: unknown; prompt?: unknown }
  return templateAgentId === agentId && prompt === HEARTBEAT_PROMPT_SENTINEL
}

export type SyncHeartbeatResult =
  | { status: 'created'; scheduleId: string }
  | { status: 'updated'; scheduleId: string }
  | { status: 'unchanged'; scheduleId: string }
  | { status: 'disabled' }
  | { status: 'agent-not-found' }

/**
 * Ensure the agent's heartbeat schedule matches its saved configuration:
 * create it when missing, re-arm the interval when it changed. A disabled
 * heartbeat leaves any existing schedule in place — the run side already
 * no-ops on `heartbeat_enabled === false`, and the row keeps the interval
 * for when the switch comes back on.
 */
export function syncHeartbeatSchedule(agentId: string): SyncHeartbeatResult {
  const agent = agentService.getAgent(agentId)
  if (!agent) return { status: 'agent-not-found' }

  const config = agent.configuration ?? {}
  if (config.heartbeat_enabled !== true) return { status: 'disabled' }

  const intervalMinutes = normalizeHeartbeatIntervalMinutes(config.heartbeat_interval)
  const trigger = heartbeatTriggerFor(intervalMinutes)
  // heartbeat.md lives in the agent's data directory; register it as the
  // agent's user workspace so the run side can resolve the path.
  const workspacePath = agentDataDirectoryPath(application.getPath('feature.agents.data'), agentId)

  const jobManager = application.get('JobManager')

  const { outcome, needsTimerSync } = application.get('DbService').withWriteTx(
    (
      tx
    ): {
      outcome: SyncHeartbeatResult
      needsTimerSync: boolean
    } => {
      const existing = jobScheduleService
        .listAllTx(tx, { type: AGENT_TASK_TYPE })
        .find((s) => isHeartbeatScheduleFor(s, agentId))

      const workspace = agentWorkspaceService.findOrCreateByPathTx(tx, workspacePath, {
        name: `${agent.name} (heartbeat)`
      })

      if (!existing) {
        const { id } = jobManager.registerJobScheduleTx(tx, {
          type: AGENT_TASK_TYPE,
          name: `heartbeat:${agentId}`,
          trigger,
          jobInputTemplate: {
            agentId,
            prompt: HEARTBEAT_PROMPT_SENTINEL,
            timeoutMinutes: HEARTBEAT_TIMEOUT_MINUTES,
            workspace: { type: 'user', workspaceId: workspace.id },
            reuseRevision: 0
          },
          metadata: writeTaskSessionReuse(undefined, { enabled: false, revision: 0 }),
          catchUpPolicy: { kind: 'skip-missed' }
        })
        return { outcome: { status: 'created', scheduleId: id }, needsTimerSync: true }
      }

      let outcome: SyncHeartbeatResult = { status: 'unchanged', scheduleId: existing.id }
      const patch: { trigger?: Trigger; jobInputTemplate?: unknown } = {}
      if (!triggersEqual(existing.trigger, trigger)) {
        patch.trigger = trigger
        outcome = { status: 'updated', scheduleId: existing.id }
      }
      // Keep the template pointed at the agent's workspace even if the workspace
      // row was recreated under a new id (e.g. after a restore).
      const template = existing.jobInputTemplate as { workspace?: { workspaceId?: string } } | null
      if (template?.workspace?.workspaceId !== workspace.id) {
        patch.jobInputTemplate = {
          agentId,
          prompt: HEARTBEAT_PROMPT_SENTINEL,
          timeoutMinutes: HEARTBEAT_TIMEOUT_MINUTES,
          workspace: { type: 'user', workspaceId: workspace.id },
          reuseRevision: 0
        }
        outcome = { status: 'updated', scheduleId: existing.id }
      }
      if (patch.trigger !== undefined || patch.jobInputTemplate !== undefined) {
        jobManager.updateJobScheduleTx(tx, existing.id, patch)
      }
      return { outcome, needsTimerSync: patch.trigger !== undefined }
    }
  )

  const scheduleId = 'scheduleId' in outcome ? outcome.scheduleId : undefined
  if (needsTimerSync && scheduleId) {
    jobManager.syncJobScheduleTimerById(scheduleId)
  }

  if (scheduleId && (outcome.status === 'created' || outcome.status === 'updated')) {
    logger.info('Heartbeat schedule ' + outcome.status, {
      agentId,
      intervalMinutes,
      scheduleId
    })
    agentTaskService.notifyReadModelChange([scheduleId])
  }
  return outcome
}
