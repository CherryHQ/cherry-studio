/**
 * Phase 1 coverage: focuses on the pure branches that do not engage the
 * Claude Code subprocess (heartbeat skip + agent-not-found). The full
 * streaming path is exercised by integration tests / Phase 5 manual e2e —
 * mocking SessionMessageOrchestrator + adapter fan-out at unit scope buys
 * little over what the integration suite already covers.
 */

import type { JobContext } from '@main/core/job/types'
import type { AgentEntity, AgentSessionEntity } from '@shared/data/api/schemas/agents'
import type { JobSnapshot } from '@shared/data/api/schemas/jobs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@application', async () => {
  const mod = await import('@test-mocks/main/application')
  return mod.mockApplicationFactory()
})

vi.mock('@data/services/AgentChannelService', () => ({
  agentChannelService: { getSubscribedChannels: vi.fn() }
}))
vi.mock('@data/services/AgentService', () => ({
  agentService: { getAgent: vi.fn() }
}))
vi.mock('@data/services/AgentSessionService', () => ({
  agentSessionService: { getSession: vi.fn(), createSession: vi.fn() }
}))
vi.mock('@data/services/JobScheduleService', () => ({
  jobScheduleService: { getById: vi.fn() }
}))
vi.mock('@data/services/JobService', () => ({
  jobService: { getById: vi.fn(), list: vi.fn() }
}))
vi.mock('@main/services/agents/services/channels/ChannelManager', () => ({
  channelManager: { getAdapter: vi.fn() }
}))
vi.mock('@main/services/agents/services/channels/sessionStreamIpc', () => ({
  broadcastSessionChanged: vi.fn()
}))
vi.mock('@main/services/agents/services/cherryclaw/heartbeat', () => ({
  readHeartbeat: vi.fn()
}))
vi.mock('@main/services/agents/services/SessionMessageOrchestrator', () => ({
  sessionMessageOrchestrator: { createSessionMessage: vi.fn() }
}))

import { agentService } from '@data/services/AgentService'
import { jobScheduleService } from '@data/services/JobScheduleService'
import { jobService } from '@data/services/JobService'
import { readHeartbeat } from '@main/services/agents/services/cherryclaw/heartbeat'

import { runAgentTask } from '../runAgentTask'

function makeJobSnapshot(scheduleId: string | null = 's1'): JobSnapshot {
  return {
    id: 'j1',
    type: 'agent.task',
    status: 'running',
    priority: 0,
    queue: 'agent:a1',
    idempotencyKey: null,
    scheduleId,
    scheduledAt: '2026-05-20T00:00:00.000Z',
    startedAt: '2026-05-20T00:00:00.000Z',
    finishedAt: null,
    attempt: 0,
    maxAttempts: 1,
    input: {},
    output: null,
    error: null,
    parentId: null,
    cancelRequested: false,
    metadata: {},
    timeoutMs: null,
    createdAt: '2026-05-20T00:00:00.000Z',
    updatedAt: '2026-05-20T00:00:00.000Z'
  }
}

function makeCtx(overrides: Partial<JobContext<{ agentId: string; prompt: string; timeoutMinutes: number }>> = {}) {
  return {
    jobId: 'j1',
    input: { agentId: 'a1', prompt: '__heartbeat__', timeoutMinutes: 2 },
    attempt: 0,
    signal: new AbortController().signal,
    metadata: {},
    patchMetadata: vi.fn(),
    reportProgress: vi.fn(),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never,
    ...overrides
  } as JobContext<{ agentId: string; prompt: string; timeoutMinutes: number }>
}

function makeAgent(config: Record<string, unknown> = {}, accessiblePaths: string[] = ['/ws/a']): AgentEntity {
  return {
    id: 'a1',
    type: 'claude-code',
    name: 'Agent A',
    model: 'sonnet',
    accessiblePaths,
    configuration: config as never,
    createdAt: '2026-05-20T00:00:00.000Z',
    updatedAt: '2026-05-20T00:00:00.000Z',
    modelName: null
  }
}

function makeSchedule(name: string | null = 'heartbeat') {
  return {
    id: 's1',
    type: 'agent.task',
    name,
    trigger: { kind: 'interval', ms: 60_000 },
    jobInputTemplate: {},
    enabled: true,
    nextRun: null,
    lastRun: null,
    catchUpPolicy: { kind: 'skip-missed' },
    metadata: {},
    createdAt: '2026-05-20T00:00:00.000Z',
    updatedAt: '2026-05-20T00:00:00.000Z'
  } as never
}

describe('runAgentTask', () => {
  beforeEach(async () => {
    vi.mocked(jobService.getById).mockReset()
    vi.mocked(jobService.list).mockReset()
    vi.mocked(jobScheduleService.getById).mockReset()
    vi.mocked(agentService.getAgent).mockReset()
    vi.mocked(readHeartbeat).mockReset()
    // Reset queues on mocks shared with other tests so unconsumed
    // `mockResolvedValueOnce` from earlier specs cannot leak into this one.
    const channelService = await import('@data/services/AgentChannelService')
    vi.mocked(channelService.agentChannelService.getSubscribedChannels).mockReset()
    const sessionService = await import('@data/services/AgentSessionService')
    vi.mocked(sessionService.agentSessionService.getSession).mockReset()
    vi.mocked(sessionService.agentSessionService.createSession).mockReset()
    const orchestrator = await import('@main/services/agents/services/SessionMessageOrchestrator')
    vi.mocked(orchestrator.sessionMessageOrchestrator.createSessionMessage).mockReset()
    const cm = await import('@main/services/agents/services/channels/ChannelManager')
    vi.mocked(cm.channelManager.getAdapter).mockReset()
    const ipc = await import('@main/services/agents/services/channels/sessionStreamIpc')
    vi.mocked(ipc.broadcastSessionChanged).mockReset()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('skips when the agent cannot be found (throws)', async () => {
    vi.mocked(jobService.getById).mockResolvedValueOnce(makeJobSnapshot())
    vi.mocked(jobScheduleService.getById).mockResolvedValueOnce(makeSchedule('heartbeat'))
    vi.mocked(agentService.getAgent).mockResolvedValueOnce(null as never)

    await expect(runAgentTask(makeCtx())).rejects.toThrow('Agent not found: a1')
  })

  it('returns "Skipped (disabled)" when heartbeat task is disabled in agent config', async () => {
    vi.mocked(jobService.getById).mockResolvedValueOnce(makeJobSnapshot())
    vi.mocked(jobScheduleService.getById).mockResolvedValueOnce(makeSchedule('heartbeat'))
    vi.mocked(agentService.getAgent).mockResolvedValueOnce(makeAgent({ heartbeat_enabled: false }))

    const out = await runAgentTask(makeCtx())

    expect(out).toEqual({ sessionId: null, result: 'Skipped (disabled)' })
    expect(readHeartbeat).not.toHaveBeenCalled()
  })

  it('returns "Skipped (disabled)" when heartbeat task has no workspace', async () => {
    vi.mocked(jobService.getById).mockResolvedValueOnce(makeJobSnapshot())
    vi.mocked(jobScheduleService.getById).mockResolvedValueOnce(makeSchedule('heartbeat'))
    vi.mocked(agentService.getAgent).mockResolvedValueOnce(makeAgent({ heartbeat_enabled: true }, []))

    const out = await runAgentTask(makeCtx())

    expect(out).toEqual({ sessionId: null, result: 'Skipped (disabled)' })
    expect(readHeartbeat).not.toHaveBeenCalled()
  })

  it('returns "Skipped (no file)" when heartbeat.md is missing', async () => {
    vi.mocked(jobService.getById).mockResolvedValueOnce(makeJobSnapshot())
    vi.mocked(jobScheduleService.getById).mockResolvedValueOnce(makeSchedule('heartbeat'))
    vi.mocked(agentService.getAgent).mockResolvedValueOnce(makeAgent({ heartbeat_enabled: true }))
    vi.mocked(readHeartbeat).mockResolvedValueOnce(undefined)

    const out = await runAgentTask(makeCtx())

    expect(out).toEqual({ sessionId: null, result: 'Skipped (no file)' })
    expect(readHeartbeat).toHaveBeenCalledWith('/ws/a')
  })

  it('does not invoke heartbeat branch when the prompt is not the sentinel', async () => {
    // Without the sentinel, heartbeat skip cannot fire — execution proceeds to
    // channel/session setup, which we intentionally don't mock here. We only
    // assert that readHeartbeat is NOT called and that getSubscribedChannels
    // is reached (proving we exited the heartbeat branch).
    vi.mocked(jobService.getById).mockResolvedValueOnce(makeJobSnapshot(null))
    vi.mocked(jobScheduleService.getById).mockResolvedValueOnce(null as never)
    vi.mocked(agentService.getAgent).mockResolvedValueOnce(makeAgent({ heartbeat_enabled: true }))

    // Force a clean throw past the heartbeat branch — createSession returning
    // null is the simplest deterministic failure.
    const sessionService = await import('@data/services/AgentSessionService')
    vi.mocked(sessionService.agentSessionService.createSession).mockResolvedValueOnce(null as never)
    vi.mocked(jobService.list).mockResolvedValueOnce([])

    const channelService = await import('@data/services/AgentChannelService')
    vi.mocked(channelService.agentChannelService.getSubscribedChannels).mockResolvedValueOnce([])

    await expect(
      runAgentTask(makeCtx({ input: { agentId: 'a1', prompt: 'do something', timeoutMinutes: 2 } }))
    ).rejects.toThrow('Failed to create session for agent a1')

    expect(readHeartbeat).not.toHaveBeenCalled()
  })

  it('routes final delivery to onStreamError (not onStreamComplete) when signal aborts mid-stream', async () => {
    vi.mocked(jobService.getById).mockResolvedValueOnce(makeJobSnapshot())
    vi.mocked(jobScheduleService.getById).mockResolvedValueOnce(makeSchedule('user-task'))
    vi.mocked(agentService.getAgent).mockResolvedValueOnce(makeAgent({ heartbeat_enabled: true }))
    vi.mocked(jobService.list).mockResolvedValueOnce([]) // no prior completed run

    const channelService = await import('@data/services/AgentChannelService')
    vi.mocked(channelService.agentChannelService.getSubscribedChannels).mockResolvedValueOnce([
      { id: 'ch-1', sessionId: null } as never
    ])

    const sessionService = await import('@data/services/AgentSessionService')
    const sessionEntity = {
      id: 'sess-new',
      agentId: 'a1',
      agentType: 'claude-code',
      accessiblePaths: [],
      model: 'sonnet',
      createdAt: '2026-05-20T00:00:00.000Z',
      updatedAt: '2026-05-20T00:00:00.000Z'
    } as unknown as AgentSessionEntity
    vi.mocked(sessionService.agentSessionService.createSession).mockResolvedValueOnce(sessionEntity)

    const onStreamComplete = vi.fn().mockResolvedValue(true)
    const onStreamError = vi.fn().mockResolvedValue(undefined)
    const onTextUpdate = vi.fn().mockResolvedValue(undefined)
    const sendMessage = vi.fn().mockResolvedValue(undefined)
    const channelManager = await import('@main/services/agents/services/channels/ChannelManager')
    vi.mocked(channelManager.channelManager.getAdapter).mockReturnValue({
      channelId: 'ch-1',
      notifyChatIds: ['chat-1'],
      onStreamComplete,
      onStreamError,
      onTextUpdate,
      sendMessage
    } as never)

    // Pre-aborted signal + pre-closed stream: removes timing races. When the
    // orchestrator yields its stream, `reader.read()` resolves immediately with
    // `done:true`; `makeRunController` propagates the outer abort into the inner
    // controller synchronously, so `signal.aborted` is `true` by the time the
    // final-delivery check runs.
    const stream = new ReadableStream({
      start(c) {
        c.close()
      }
    })

    const orchestrator = await import('@main/services/agents/services/SessionMessageOrchestrator')
    vi.mocked(orchestrator.sessionMessageOrchestrator.createSessionMessage).mockResolvedValueOnce({
      stream,
      completion: Promise.resolve({})
    } as never)

    const outerAbort = new AbortController()
    outerAbort.abort(new Error('cancelled by user'))

    await expect(
      runAgentTask(
        makeCtx({
          signal: outerAbort.signal,
          // timeoutMinutes=0 disables the per-task timer so the abort comes
          // purely from the outer signal — what we want to exercise.
          input: { agentId: 'a1', prompt: 'do something', timeoutMinutes: 0 }
        })
      )
    ).rejects.toThrow(/cancelled/)

    expect(onStreamError).toHaveBeenCalledTimes(1)
    expect(onStreamError).toHaveBeenCalledWith('chat-1', expect.stringContaining('cancelled'))
    expect(onStreamComplete).not.toHaveBeenCalled()
    expect(sendMessage).not.toHaveBeenCalled()

    const sessionIpc = await import('@main/services/agents/services/channels/sessionStreamIpc')
    expect(vi.mocked(sessionIpc.broadcastSessionChanged)).toHaveBeenCalledWith('a1', 'sess-new', false)
  })

  it('reuses an existing session id from the last completed run when available', async () => {
    vi.mocked(jobService.getById).mockResolvedValueOnce(makeJobSnapshot())
    vi.mocked(jobScheduleService.getById).mockResolvedValueOnce(makeSchedule('user-task'))
    vi.mocked(agentService.getAgent).mockResolvedValueOnce(makeAgent({ heartbeat_enabled: true }))

    const channelService = await import('@data/services/AgentChannelService')
    vi.mocked(channelService.agentChannelService.getSubscribedChannels).mockResolvedValueOnce([])

    vi.mocked(jobService.list).mockResolvedValueOnce([{ output: { sessionId: 'sess-old' } } as JobSnapshot])

    const sessionService = await import('@data/services/AgentSessionService')
    const sessionEntity = {
      id: 'sess-old',
      agentId: 'a1',
      agentType: 'claude-code',
      accessiblePaths: [],
      model: 'sonnet',
      createdAt: '2026-05-20T00:00:00.000Z',
      updatedAt: '2026-05-20T00:00:00.000Z'
    } as unknown as AgentSessionEntity
    vi.mocked(sessionService.agentSessionService.getSession).mockResolvedValueOnce(sessionEntity)
    vi.mocked(sessionService.agentSessionService.getSession).mockResolvedValueOnce(sessionEntity)

    const orchestrator = await import('@main/services/agents/services/SessionMessageOrchestrator')
    vi.mocked(orchestrator.sessionMessageOrchestrator.createSessionMessage).mockRejectedValueOnce(
      new Error('orchestrator-stub')
    )

    await expect(
      runAgentTask(makeCtx({ input: { agentId: 'a1', prompt: 'real prompt', timeoutMinutes: 2 } }))
    ).rejects.toThrow('orchestrator-stub')

    expect(sessionService.agentSessionService.getSession).toHaveBeenCalledWith('a1', 'sess-old')
    expect(sessionService.agentSessionService.createSession).not.toHaveBeenCalled()
  })
})
