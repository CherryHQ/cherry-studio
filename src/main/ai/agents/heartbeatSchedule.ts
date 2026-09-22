/**
 * Heartbeat schedules are identified by agentId and the reserved prompt.
 * Their instructions live in the agent data directory, independently of session workspaces.
 */

import { randomUUID } from 'node:crypto'

import { application } from '@application'
import { notifyDataApiDataChange } from '@data/dataApiDataChange'
import { agentService } from '@data/services/AgentService'
import {
  agentTaskService,
  HEARTBEAT_PROMPT_SENTINEL,
  isCircuitBreakerPaused,
  writeCircuitBreakerPaused
} from '@data/services/AgentTaskService'
import { agentWorkspaceService } from '@data/services/AgentWorkspaceService'
import { jobScheduleService } from '@data/services/JobScheduleService'
import { loggerService } from '@logger'
import { clampHeartbeatIntervalMinutes, isHeartbeatEnabled } from '@shared/ai/agentHeartbeat'
import { AGENT_RUNTIME_CAPABILITIES } from '@shared/ai/agentRuntimeCapabilities'
import { DataApiError, ErrorCode } from '@shared/data/api/errors'
import { AGENT_WORKSPACE_TYPE, AgentSessionWorkspaceSourceSchema } from '@shared/data/api/schemas/agentWorkspaces'
import { JOB_ERROR_CODES, type JobScheduleSnapshot, type Trigger, triggersEqual } from '@shared/data/api/schemas/jobs'

import { agentDataDirectoryPath, assertAgentStoragePath } from './agentDataDirectory'
import { DEFAULT_AGENT_TASK_TIMEOUT_MINUTES } from './agentTaskDefaults'
import { ensureHeartbeatFile, HeartbeatFileNotRegularError } from './heartbeat'

const logger = loggerService.withContext('HeartbeatSchedule')

const AGENT_TASK_TYPE = 'agent.task' as const

/**
 * Reserved schedule names: exactly the `heartbeat_<agentId>` rows sync can
 * mint for a live agent. Agent ids include non-uuid builtins ('cherry-support'),
 * so the check resolves the suffix against the agent table instead of a uuid
 * pattern. (type, name) is UNIQUE per type — any agent's reserved name is
 * reserved for everyone, and a plain `heartbeat_daily` is NOT reserved.
 */
export function isReservedHeartbeatScheduleName(name: string): boolean {
  if (!name.startsWith('heartbeat_')) return false
  const agentId = name.slice('heartbeat_'.length)
  return agentId.length > 0 && agentService.getAgent(agentId) !== null
}

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
  // Only a string that trims to the sentinel is a corrupted heartbeat.
  // Preserve foreign tasks that happen to occupy a reserved name.
  if (row.name !== `heartbeat_${agentId}`) return false
  const template = row.jobInputTemplate as { agentId?: unknown; prompt?: unknown } | null
  if (template?.agentId !== agentId) return false
  return typeof template.prompt === 'string' && template.prompt.trim() === HEARTBEAT_PROMPT_SENTINEL
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
  return Object.hasOwn(template, 'workspace')
}

/** Pause (never delete) every enabled heartbeat row; returns the paused ids. */
function pauseHeartbeatRows(
  agentId: string,
  rows: JobScheduleSnapshot[],
  options: { clearBreakerMarker: boolean }
): string[] {
  // Pause every migrated duplicate; only an explicit toggle-off resets the breaker.
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

/**
 * Best-effort pause for a stranded heartbeat row — the same disable + timer
 * resync the tick's dead-source paths need, kept here so every pause site
 * shares one shape.
 */
export function pauseHeartbeatSchedule(agentId: string, scheduleId: string, warnMessage: string): void {
  try {
    application.get('DbService').withWriteTx((tx) => {
      application.get('JobManager').updateJobScheduleTx(tx, scheduleId, { enabled: false })
    })
    application.get('JobManager').syncJobScheduleTimerById(scheduleId)
  } catch (pauseError) {
    logger.warn(warnMessage, { agentId, scheduleId, error: pauseError })
  }
}

/**
 * Best-effort arm for a just-committed schedule row — a failed timer
 * registration must not fail the sync whose row already committed; the next
 * sync or restart re-arms it.
 */
function armCommittedScheduleTimer(scheduleId: string): void {
  try {
    application.get('JobManager').syncJobScheduleTimerById(scheduleId)
  } catch (error) {
    logger.warn('Failed to arm the timer for a committed heartbeat schedule', { scheduleId, error })
  }
}

export async function syncHeartbeatSchedule(
  agentId: string,
  signal: AbortSignal,
  rows: JobScheduleSnapshot[] = jobScheduleService.listAll({ type: AGENT_TASK_TYPE })
): Promise<HeartbeatSyncOutcome> {
  signal.throwIfAborted()
  const agent = agentService.getAgent(agentId)
  if (!agent) return 'skipped-missing-agent'

  // The ids of anything this sync wrote — the mid-sync deletion guard below
  // needs them to undo the writes.
  const touchedScheduleIds: string[] = []
  const finalize = async (outcome: HeartbeatSyncOutcome): Promise<HeartbeatSyncOutcome> => {
    // Agent deletion may finish during file IO; compensate any writes that followed it.
    if (touchedScheduleIds.length === 0) return outcome
    const state = agentService.getLifecycleState(agentId)
    if (state === 'active') return outcome
    if (state === 'trashed') {
      const scheduleIds = application
        .get('DbService')
        .withWriteTx((tx) => agentTaskService.setOwnerStateTx(tx, agentId, 'trashed', Date.now()))
      for (const scheduleId of scheduleIds) application.get('JobManager').syncJobScheduleTimerById(scheduleId)
      return 'skipped-missing-agent'
    }
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
    return 'skipped-missing-agent'
  }

  const changedWorkspaceIds: string[] = []
  application.get('DbService').withWriteTx((tx) => {
    for (const row of rows) {
      if (!matchesHeartbeatIdentity(row, agentId)) continue
      const current = jobScheduleService.getByIdTx(tx, row.id)
      if (!current || !matchesHeartbeatIdentity(current, agentId)) continue
      const input = current.jobInputTemplate as Record<string, unknown>
      if (!Object.hasOwn(input, 'workspace')) continue
      const { workspace, ...template } = input
      application.get('JobManager').updateJobScheduleTx(tx, current.id, { jobInputTemplate: template })
      const source = AgentSessionWorkspaceSourceSchema.safeParse(workspace)
      if (source.success && source.data.type === AGENT_WORKSPACE_TYPE.USER) {
        const directory = agentDataDirectoryPath(application.getPath('feature.agents.data'), agentId)
        agentWorkspaceService.deleteIfUnreferencedTx(tx, source.data.workspaceId, directory)
        changedWorkspaceIds.push(source.data.workspaceId)
      }
      touchedScheduleIds.push(current.id)
    }
  })
  if (changedWorkspaceIds.length > 0) {
    notifyDataApiDataChange([{ endpoint: '/agent-workspaces', kind: 'membership', entityIds: changedWorkspaceIds }])
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

  // Honor runtime capabilities even for schedules provisioned before a capability change.
  if (capabilities.heartbeat !== true) {
    touchedScheduleIds.push(...pauseHeartbeatRows(agentId, rows, { clearBreakerMarker: false }))
    return finalize('skipped-capability')
  }

  const config = agent.configuration ?? {}

  if (!isHeartbeatEnabled(config)) {
    // Keep disabled rows for reuse; an explicit toggle-off also resets the breaker.
    const pausedScheduleIds = pauseHeartbeatRows(agentId, rows, { clearBreakerMarker: true })
    touchedScheduleIds.push(...pausedScheduleIds)
    return finalize(pausedScheduleIds.length > 0 ? 'paused' : 'skipped-disabled')
  }

  const intervalMinutes = clampHeartbeatIntervalMinutes(config.heartbeat_interval)

  const agentsDataRoot = application.getPath('feature.agents.data')
  const agentDataPath = agentDataDirectoryPath(agentsDataRoot, agentId)
  try {
    // A symlinked/tampered agent directory must not lead provisioning (or
    // the run side's heartbeat.md read) outside managed storage.
    await assertAgentStoragePath(agentsDataRoot, agentDataPath)
  } catch (error) {
    signal.throwIfAborted()
    logger.warn('Agent data path failed the storage check; heartbeat not armed', { agentId, agentDataPath, error })
    // Pause like the other skip branches: a still-enabled row would keep
    // firing completed skip jobs until a later successful sync re-arms it.
    touchedScheduleIds.push(...pauseHeartbeatRows(agentId, rows, { clearBreakerMarker: false }))
    return finalize('skipped-untrusted-path')
  }
  signal.throwIfAborted()
  try {
    await ensureHeartbeatFile(agentDataPath)
    signal.throwIfAborted()
  } catch (error) {
    signal.throwIfAborted()
    // A non-regular occupant at heartbeat.md makes every tick fail its read
    // — pause like the untrusted path instead of firing skips forever.
    if (!(error instanceof HeartbeatFileNotRegularError)) throw error
    logger.warn('Heartbeat file path is not a regular file; heartbeat not armed', { agentId, agentDataPath })
    touchedScheduleIds.push(...pauseHeartbeatRows(agentId, rows, { clearBreakerMarker: false }))
    return finalize('skipped-untrusted-path')
  }
  // Re-check inside the provisioning window: mkdir follows ancestor links,
  // so a directory swapped in after the entry check must not arm a row.
  await assertAgentStoragePath(agentsDataRoot, agentDataPath)
  signal.throwIfAborted()
  const trigger: Trigger = { kind: 'interval', ms: intervalMinutes * 60_000 }
  const jobInputTemplate: HeartbeatJobInputTemplate = {
    agentId,
    prompt: HEARTBEAT_PROMPT_SENTINEL,
    timeoutMinutes: DEFAULT_AGENT_TASK_TIMEOUT_MINUTES,
    reuseRevision: 0
  }

  const jobManager = application.get('JobManager')
  const scheduleName = `heartbeat_${agentId}`

  // The repair branch is shared by the create-race fallback below, so it is
  // factored into a local that both paths can reach.
  const repairRow = (row: JobScheduleSnapshot): HeartbeatSyncOutcome => {
    // Preserve migrated names and newly committed breaker stops when repairing drift.
    const repair = application.get('DbService').withWriteTx((tx) => {
      const current = jobScheduleService.getByIdTx(tx, row.id)
      if (!current || !matchesHeartbeatIdentity(current, agentId)) return null
      const breakerPaused = !current.enabled && isCircuitBreakerPaused(current.metadata)
      const reenable = !current.enabled && !breakerPaused
      const triggerChanged = !triggersEqual(current.trigger, trigger)
      if (!reenable && !triggerChanged && !templateDrifted(current.jobInputTemplate, jobInputTemplate)) return null
      jobManager.updateJobScheduleTx(tx, current.id, {
        ...(reenable ? { enabled: true } : {}),
        ...(triggerChanged ? { trigger } : {}),
        jobInputTemplate
      })
      return { breakerPaused, rearm: (reenable || triggerChanged) && !breakerPaused }
    })
    if (!repair) return touchedScheduleIds.includes(row.id) ? 'updated' : 'noop'
    const { breakerPaused, rearm } = repair
    if (rearm) armCommittedScheduleTimer(row.id)
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
  // Converge migrated duplicates independently so one removal failure cannot strand the rest.
  const duplicates = rows.filter((row) => row.id !== existing?.id && matchesHeartbeatIdentity(row, agentId))
  const removals = await Promise.allSettled(
    duplicates.map(async (row) => {
      try {
        await jobManager.unregisterJobScheduleById(row.id)
      } catch (error) {
        // A transient unregister failure must not leave the duplicate armed
        // beside the canonical row — pause best-effort, mirroring the sweep.
        pauseHeartbeatSchedule(agentId, row.id, 'Failed to remove a duplicate heartbeat schedule')
        throw error
      }
      logger.info('Removed duplicate heartbeat schedule', { agentId, scheduleId: row.id })
    })
  )
  removals.forEach((result, index) => {
    if (result.status === 'rejected') {
      logger.warn('Failed to remove duplicate heartbeat schedule', {
        agentId,
        scheduleId: duplicates[index].id,
        error: result.reason
      })
    }
  })
  signal.throwIfAborted()
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
      armCommittedScheduleTimer(id)
      touchedScheduleIds.push(id)
      logger.info('Heartbeat schedule created', { agentId, scheduleId: id, intervalMinutes })
      return finalize('created')
    } catch (error) {
      if (!isScheduleNameConflict(error)) throw error
      const winner = jobScheduleService.getByTypeAndName(AGENT_TASK_TYPE, scheduleName)
      // Only repair a conflicting row owned by this agent and identified as its heartbeat.
      if (winner && matchesHeartbeatIdentity(winner, agentId)) {
        logger.info('Heartbeat create raced a concurrent sync; repairing winner', {
          agentId,
          scheduleId: winner.id
        })
        return finalize(repairRow(winner))
      }
      // Preserve foreign rows occupying reserved names; sentinel identity permits another name.
      const disambiguated = `${scheduleName}__${randomUUID().slice(0, 8)}`
      logger.warn('Reserved heartbeat schedule name is used by a foreign row; using a disambiguated name', {
        agentId,
        scheduleName,
        disambiguated,
        winnerId: winner?.id
      })
      const { id } = application.get('DbService').withWriteTx((tx) =>
        jobManager.registerJobScheduleTx(tx, {
          type: AGENT_TASK_TYPE,
          name: disambiguated,
          trigger,
          jobInputTemplate,
          catchUpPolicy: { kind: 'skip-missed' }
        })
      )
      armCommittedScheduleTimer(id)
      touchedScheduleIds.push(id)
      logger.info('Heartbeat schedule created', { agentId, scheduleId: id, intervalMinutes })
      return finalize('created')
    }
  }

  return finalize(repairRow(existing))
}

/**
 * Startup pass: converge each agent's heartbeat and isolate per-agent failures.
 * Existing schedules are repaired in place without changing their identity.
 */
export async function repairHeartbeatSchedules(
  sync: (agentId: string, rows: JobScheduleSnapshot[]) => Promise<HeartbeatSyncOutcome | undefined>,
  signal: AbortSignal
): Promise<void> {
  signal.throwIfAborted()
  const { agents } = agentService.listAgents()
  // Share discovery across agents; mutation decisions re-read the row inside their transaction.
  const rows = jobScheduleService.listAll({ type: AGENT_TASK_TYPE })
  const counts = new Map<HeartbeatSyncOutcome | 'failed', number>()
  // Per-agent I/O is independent — overlap it; one rejection must not block the rest.
  const results = await Promise.allSettled(agents.map((agent) => sync(agent.id, rows)))
  results.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      if (result.value) counts.set(result.value, (counts.get(result.value) ?? 0) + 1)
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
  signal.throwIfAborted()
  await reapOrphanedScheduleRows(rows, signal)
}

function readTemplateAgentId(row: JobScheduleSnapshot): string | null {
  const template = row.jobInputTemplate as { agentId?: unknown } | null
  return typeof template?.agentId === 'string' && template.agentId.length > 0 ? template.agentId : null
}

function dropOrphanWorkspace(scheduleId: string, workspaceId: string): void {
  try {
    const removed = application
      .get('DbService')
      .withWriteTx((tx) => agentWorkspaceService.deleteIfUnreferencedTx(tx, workspaceId))
    if (!removed) {
      logger.info('Kept an orphaned schedule workspace still referenced after reaping', { scheduleId, workspaceId })
    }
  } catch (error) {
    logger.warn('Failed to drop an orphaned schedule workspace', { scheduleId, workspaceId, error })
  }
}

/**
 * Startup reaper for agent.task rows whose producer agent is gone — a deletion
 * sweep can fail transiently mid-unregister and leave the row (and its user
 * workspace) behind. Per-row isolation, mirroring the sweep.
 */
async function reapOrphanedScheduleRows(rows: JobScheduleSnapshot[], signal: AbortSignal): Promise<void> {
  const orphans = rows.filter((row) => {
    const producer = readTemplateAgentId(row)
    return producer !== null && agentService.getLifecycleState(producer) === 'missing'
  })
  const reaped: string[] = []
  for (const row of orphans) {
    signal.throwIfAborted()
    try {
      if (!(await application.get('JobManager').unregisterJobScheduleById(row.id))) continue
    } catch (error) {
      logger.warn('Failed to reap an orphaned agent task schedule', { scheduleId: row.id, error })
      pauseHeartbeatSchedule(readTemplateAgentId(row) ?? '', row.id, 'Failed to pause an orphaned agent task schedule')
      continue
    }
    reaped.push(row.id)
    const template = row.jobInputTemplate as { workspace?: { type?: unknown; workspaceId?: unknown } | null } | null
    const workspace = template?.workspace
    // Mirror the deletion sweep: only a heartbeat's workspace row goes — an
    // ordinary task's user-picked workspace outlives its producer agent.
    if (
      workspace?.type === AGENT_WORKSPACE_TYPE.USER &&
      typeof workspace.workspaceId === 'string' &&
      matchesHeartbeatIdentity(row, readTemplateAgentId(row) ?? '')
    ) {
      dropOrphanWorkspace(row.id, workspace.workspaceId)
    }
  }
  if (reaped.length > 0) {
    logger.info('Reaped orphaned agent task schedules at startup', { scheduleIds: reaped })
    agentTaskService.notifyReadModelChange(reaped)
  }
}
