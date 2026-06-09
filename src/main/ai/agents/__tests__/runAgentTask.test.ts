/**
 * Phase 1 coverage: focuses on the pure branches that do not engage the
 * Claude Code subprocess (heartbeat skip + agent-not-found). The full
 * streaming path is exercised by integration tests / Phase 5 manual e2e.
 *
 * Each fire creates a fresh session — there is no cross-fire session reuse.
 */

import type { JobContext } from '@main/core/job/types'
import { DataApiErrorFactory } from '@shared/data/api'
import type { AgentEntity } from '@shared/data/api/schemas/agents'
import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'
import type { AgentSessionWorkspaceSource } from '@shared/data/api/schemas/agentWorkspaces'
import type { JobSnapshot } from '@shared/data/api/schemas/jobs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockAbort, mockGetAdapter, mockStartRun, captured } = vi.hoisted(() => {
  const captured: { listeners: Array<Record<string, (arg?: unknown) => void>> } = { listeners: [] }
  return {
    mockAbort: vi.fn(),
    mockGetAdapter: vi.fn(() => undefined),
    mockStartRun: vi.fn(async (opts: { listeners: typeof captured.listeners }) => {
      captured.listeners = opts.listeners
    }),
    captured
  }
})

vi.mock('@application', async () => {
  const mod = await import('@test-mocks/main/application')
  return mod.mockApplicationFactory({
    // ChannelManager + AiStreamManager aren't in the default mock service set; the
    // streaming path (post heartbeat-skip) reads both, so wire minimal stubs here.
    ChannelManager: { getAdapter: mockGetAdapter },
    AiStreamManager: { abort: mockAbort }
  } as never)
})

vi.mock('@main/ai/streamManager/api/startAgentSessionRun', () => ({
  startAgentSessionRun: mockStartRun
}))

vi.mock('@data/services/AgentChannelService', () => ({
  agentChannelService: { getSubscribedChannels: vi.fn() }
}))
vi.mock('@data/services/AgentService', () => ({
  agentService: { getAgent: vi.fn() }
}))
vi.mock('@data/services/AgentSessionService', () => ({
  agentSessionService: { create: vi.fn() }
}))
vi.mock('@data/services/AgentWorkspaceService', () => ({
  agentWorkspaceService: { getById: vi.fn() }
}))
vi.mock('@data/services/JobScheduleService', () => ({
  jobScheduleService: { getById: vi.fn() }
}))
vi.mock('@data/services/JobService', () => ({
  jobService: { getById: vi.fn() }
}))
vi.mock('@main/ai/agents/cherryclaw/heartbeat', () => ({
  readHeartbeat: vi.fn()
}))

import { agentChannelService } from '@data/services/AgentChannelService'
import { agentService } from '@data/services/AgentService'
import { agentSessionService } from '@data/services/AgentSessionService'
import { agentWorkspaceService } from '@data/services/AgentWorkspaceService'
import { jobScheduleService } from '@data/services/JobScheduleService'
import { jobService } from '@data/services/JobService'
import { readHeartbeat } from '@main/ai/agents/cherryclaw/heartbeat'
import { buildAgentSessionTopicId } from '@main/ai/agentSession/topic'

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

type TestAgentTaskInput = {
  agentId: string
  prompt: string
  timeoutMinutes: number
  workspace: AgentSessionWorkspaceSource
}

type TestJobContextOverrides = Omit<Partial<JobContext<TestAgentTaskInput>>, 'input'> & {
  input?: Partial<TestAgentTaskInput>
}

function makeCtx(overrides: TestJobContextOverrides = {}) {
  const { input: inputOverride, ...rest } = overrides
  return {
    jobId: 'j1',
    input: {
      agentId: 'a1',
      prompt: '__heartbeat__',
      timeoutMinutes: 2,
      workspace: { type: 'user', workspaceId: 'ws-1' },
      ...inputOverride
    },
    attempt: 0,
    signal: new AbortController().signal,
    metadata: {},
    patchMetadata: vi.fn(),
    reportProgress: vi.fn(),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never,
    ...rest
  } as JobContext<TestAgentTaskInput>
}

function makeAgent(config: Record<string, unknown> = {}): AgentEntity {
  return {
    id: 'a1',
    type: 'claude-code',
    name: 'Agent A',
    model: 'sonnet' as never,
    configuration: config as never,
    createdAt: '2026-05-20T00:00:00.000Z',
    updatedAt: '2026-05-20T00:00:00.000Z',
    modelName: null
  }
}

function makeSession(workspacePath: string | null = '/ws/a'): AgentSessionEntity {
  return {
    id: 'sess-new',
    agentId: 'a1',
    name: 'Scheduled task',
    workspaceId: 'ws-1',
    workspace: {
      id: 'ws-1',
      name: 'ws',
      path: workspacePath ?? '/ws/a',
      type: 'user',
      orderKey: 'k',
      createdAt: '2026-05-20T00:00:00.000Z',
      updatedAt: '2026-05-20T00:00:00.000Z'
    },
    orderKey: 'k',
    createdAt: '2026-05-20T00:00:00.000Z',
    updatedAt: '2026-05-20T00:00:00.000Z'
  } as AgentSessionEntity
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
  beforeEach(() => {
    vi.mocked(jobService.getById).mockReset()
    vi.mocked(jobScheduleService.getById).mockReset()
    vi.mocked(agentService.getAgent).mockReset()
    vi.mocked(agentSessionService.create).mockReset()
    vi.mocked(agentWorkspaceService.getById).mockReset()
    vi.mocked(readHeartbeat).mockReset()
    vi.mocked(agentChannelService.getSubscribedChannels).mockReset().mockResolvedValue([])
    mockStartRun.mockClear()
    mockAbort.mockClear()
    mockGetAdapter.mockClear()
    captured.listeners = []
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('throws when the agent cannot be found', async () => {
    vi.mocked(jobService.getById).mockResolvedValueOnce(makeJobSnapshot())
    vi.mocked(jobScheduleService.getById).mockResolvedValueOnce(makeSchedule('heartbeat'))
    vi.mocked(agentService.getAgent).mockResolvedValueOnce(null as never)

    await expect(runAgentTask(makeCtx())).rejects.toThrow('Agent not found: a1')
  })

  // A disabled heartbeat must short-circuit BEFORE createSession — that call also
  // lazily provisions a workspace on first fire, so creating a session for a fire
  // we're going to drop would accrete a session row (and workspace) every interval.
  it('skips a disabled heartbeat WITHOUT creating a session', async () => {
    vi.mocked(jobService.getById).mockResolvedValueOnce(makeJobSnapshot())
    vi.mocked(jobScheduleService.getById).mockResolvedValueOnce(makeSchedule('heartbeat'))
    vi.mocked(agentService.getAgent).mockResolvedValueOnce(makeAgent({ heartbeat_enabled: false }))

    const out = await runAgentTask(makeCtx())

    expect(out).toEqual({ sessionId: null, result: 'Skipped (disabled)' })
    expect(agentSessionService.create).not.toHaveBeenCalled()
    expect(readHeartbeat).not.toHaveBeenCalled()
  })

  it('skips an enabled heartbeat with system workspace WITHOUT creating a session', async () => {
    vi.mocked(jobService.getById).mockResolvedValueOnce(makeJobSnapshot())
    vi.mocked(jobScheduleService.getById).mockResolvedValueOnce(makeSchedule('heartbeat'))
    vi.mocked(agentService.getAgent).mockResolvedValueOnce(makeAgent({ heartbeat_enabled: true }))

    const out = await runAgentTask(
      makeCtx({ input: { agentId: 'a1', prompt: '__heartbeat__', timeoutMinutes: 2, workspace: { type: 'system' } } })
    )

    expect(out).toEqual({ sessionId: null, result: 'Skipped (no file)' })
    expect(agentSessionService.create).not.toHaveBeenCalled()
    expect(agentWorkspaceService.getById).not.toHaveBeenCalled()
    expect(readHeartbeat).not.toHaveBeenCalled()
  })

  it('skips an enabled heartbeat when its user workspace was deleted WITHOUT creating a session', async () => {
    vi.mocked(jobService.getById).mockResolvedValueOnce(makeJobSnapshot())
    vi.mocked(jobScheduleService.getById).mockResolvedValueOnce(makeSchedule('heartbeat'))
    vi.mocked(agentService.getAgent).mockResolvedValueOnce(makeAgent({ heartbeat_enabled: true }))
    vi.mocked(agentWorkspaceService.getById).mockRejectedValueOnce(DataApiErrorFactory.notFound('Workspace', 'ws-1'))

    const out = await runAgentTask(makeCtx())

    expect(out).toEqual({ sessionId: null, result: 'Skipped (workspace deleted)' })
    expect(agentSessionService.create).not.toHaveBeenCalled()
    expect(readHeartbeat).not.toHaveBeenCalled()
  })

  it('rejects an enabled heartbeat whose user source resolves to a system workspace', async () => {
    vi.mocked(jobService.getById).mockResolvedValueOnce(makeJobSnapshot())
    vi.mocked(jobScheduleService.getById).mockResolvedValueOnce(makeSchedule('heartbeat'))
    vi.mocked(agentService.getAgent).mockResolvedValueOnce(makeAgent({ heartbeat_enabled: true }))
    vi.mocked(agentWorkspaceService.getById).mockResolvedValueOnce({
      id: 'ws-1',
      type: 'system',
      path: '/ws/system'
    } as never)

    await expect(runAgentTask(makeCtx())).rejects.toThrow('Heartbeat workspace must be user-owned: ws-1')
    expect(agentSessionService.create).not.toHaveBeenCalled()
    expect(readHeartbeat).not.toHaveBeenCalled()
  })

  it('skips an enabled heartbeat with no heartbeat.md WITHOUT creating a session', async () => {
    vi.mocked(jobService.getById).mockResolvedValueOnce(makeJobSnapshot())
    vi.mocked(jobScheduleService.getById).mockResolvedValueOnce(makeSchedule('heartbeat'))
    vi.mocked(agentService.getAgent).mockResolvedValueOnce(makeAgent({ heartbeat_enabled: true }))
    vi.mocked(agentWorkspaceService.getById).mockResolvedValueOnce({ id: 'ws-1', type: 'user', path: '/ws/a' } as never)
    vi.mocked(readHeartbeat).mockResolvedValueOnce(undefined)

    const out = await runAgentTask(makeCtx())

    expect(out).toEqual({ sessionId: null, result: 'Skipped (no file)' })
    expect(agentSessionService.create).not.toHaveBeenCalled()
    expect(readHeartbeat).toHaveBeenCalledWith('/ws/a')
  })

  it('creates a session and runs when an enabled heartbeat has content', async () => {
    vi.mocked(jobService.getById).mockResolvedValueOnce(makeJobSnapshot())
    vi.mocked(jobScheduleService.getById).mockResolvedValueOnce(makeSchedule('heartbeat'))
    vi.mocked(agentService.getAgent).mockResolvedValueOnce(makeAgent({ heartbeat_enabled: true }))
    vi.mocked(agentWorkspaceService.getById).mockResolvedValueOnce({ id: 'ws-1', type: 'user', path: '/ws/a' } as never)
    vi.mocked(readHeartbeat).mockResolvedValueOnce('check the inbox')
    vi.mocked(agentSessionService.create).mockResolvedValueOnce(makeSession('/ws/a'))

    const promise = runAgentTask(makeCtx())
    await vi.waitFor(() => expect(mockStartRun).toHaveBeenCalled())
    captured.listeners[0].onDone({ status: 'completed' })
    await promise

    expect(readHeartbeat).toHaveBeenCalledWith('/ws/a')
    expect(agentSessionService.create).toHaveBeenCalledWith({
      agentId: 'a1',
      name: 'heartbeat',
      workspace: { type: 'user', workspaceId: 'ws-1' }
    })
  })

  // C1 (agents-jobs-3): a `text-delta` chunk's payload is on `.delta`, not `.text`.
  // The previous `as { text }` cast silently accumulated nothing, so every run
  // persisted the `'Completed'` fallback instead of the model's reply.
  it('accumulates text-delta chunks via .delta into the result', async () => {
    vi.mocked(jobService.getById).mockResolvedValueOnce(makeJobSnapshot())
    vi.mocked(jobScheduleService.getById).mockResolvedValueOnce(makeSchedule('daily-summary'))
    vi.mocked(agentService.getAgent).mockResolvedValueOnce(makeAgent())
    vi.mocked(agentSessionService.create).mockResolvedValueOnce(makeSession('/ws/a'))

    const promise = runAgentTask(makeCtx({ input: { agentId: 'a1', prompt: 'hi', timeoutMinutes: 0 } }))

    await vi.waitFor(() => expect(mockStartRun).toHaveBeenCalled())
    const sentinel = captured.listeners[0]
    sentinel.onChunk({ type: 'text-delta', delta: 'Hello ' })
    sentinel.onChunk({ type: 'text-delta', delta: 'world' })
    sentinel.onChunk({ type: 'reasoning-delta', delta: 'ignored' })
    sentinel.onDone({ status: 'completed' })

    const out = await promise
    expect(out).toEqual({ sessionId: 'sess-new', result: 'Hello world' })
  })

  // agents-jobs-4: on a non-abort error, a subscribed channel must be notified exactly
  // once. The channel listener's generic `Error: …` is suppressed for task runs so only
  // the richer `[Task failed]` summary from notifyTaskError is delivered (no double-send).
  it('notifies a subscribed channel exactly once on a non-abort run error', async () => {
    vi.mocked(jobService.getById).mockResolvedValueOnce(makeJobSnapshot('s1'))
    vi.mocked(jobScheduleService.getById).mockResolvedValueOnce(makeSchedule('daily-summary'))
    vi.mocked(agentService.getAgent).mockResolvedValueOnce(makeAgent())
    vi.mocked(agentSessionService.create).mockResolvedValueOnce(makeSession('/ws/a'))
    vi.mocked(agentChannelService.getSubscribedChannels).mockResolvedValueOnce([{ id: 'ch1' }] as never)

    const adapter = {
      channelId: 'ch1',
      connected: true,
      notifyChatIds: ['chat-1'],
      sendMessage: vi.fn<(chatId: string, text: string) => Promise<void>>(async () => {}),
      onTextUpdate: vi.fn(async () => {}),
      onStreamComplete: vi.fn(async () => true)
    }
    mockGetAdapter.mockReturnValue(adapter as never)

    const promise = runAgentTask(makeCtx({ input: { agentId: 'a1', prompt: 'hi', timeoutMinutes: 0 } }))

    await vi.waitFor(() => expect(mockStartRun).toHaveBeenCalled())
    // Simulate the stream manager dispatching the error to every listener (sentinel + channel).
    const errorResult = { error: new Error('boom'), status: 'error' }
    for (const listener of captured.listeners) {
      listener.onError?.(errorResult as never)
    }

    await expect(promise).rejects.toThrow('boom')

    // Exactly one channel message, and it's the task-framed summary — not the bare `Error: …`.
    expect(adapter.sendMessage).toHaveBeenCalledTimes(1)
    expect(adapter.sendMessage.mock.calls[0][1]).toContain('[Task failed]')
    expect(adapter.sendMessage.mock.calls[0][1]).not.toMatch(/^Error:/)
  })

  // C2 (agents-jobs-1) + agents-jobs-7: aborting the run (JobManager cancel or
  // per-task timeout) must abort the upstream stream AND settle the handler
  // promise — otherwise it leaks until the JobManager force-finalize timeout.
  it('aborts the upstream stream and rejects when the run signal aborts', async () => {
    vi.mocked(jobService.getById).mockResolvedValueOnce(makeJobSnapshot())
    vi.mocked(jobScheduleService.getById).mockResolvedValueOnce(makeSchedule('daily-summary'))
    vi.mocked(agentService.getAgent).mockResolvedValueOnce(makeAgent())
    vi.mocked(agentSessionService.create).mockResolvedValueOnce(makeSession('/ws/a'))

    const controller = new AbortController()
    const promise = runAgentTask(
      makeCtx({ signal: controller.signal, input: { agentId: 'a1', prompt: 'hi', timeoutMinutes: 0 } })
    )

    await vi.waitFor(() => expect(mockStartRun).toHaveBeenCalled())
    controller.abort(new Error('cancelled by manager'))

    await expect(promise).rejects.toThrow('cancelled by manager')
    expect(mockAbort).toHaveBeenCalledWith(buildAgentSessionTopicId('sess-new'), 'cancelled by manager')
  })

  // agents-jobs-5: a non-zero `timeoutMinutes` arms a per-task timeout timer in
  // makeRunSignal. When the stream never settles, the timer must fire, abort the
  // upstream stream, and reject the handler with the timeout error.
  it('aborts the upstream stream and rejects when the per-task timeout fires', async () => {
    vi.useFakeTimers()
    try {
      vi.mocked(jobService.getById).mockResolvedValueOnce(makeJobSnapshot())
      vi.mocked(jobScheduleService.getById).mockResolvedValueOnce(makeSchedule('daily-summary'))
      vi.mocked(agentService.getAgent).mockResolvedValueOnce(makeAgent())
      vi.mocked(agentSessionService.create).mockResolvedValueOnce(makeSession('/ws/a'))

      const promise = runAgentTask(makeCtx({ input: { agentId: 'a1', prompt: 'hi', timeoutMinutes: 1 } }))
      const assertion = expect(promise).rejects.toThrow('Task timed out after 1 minute(s)')

      // Flush the awaited setup chain (getById/getAgent/createSession/startRun) and
      // arm the timer, then advance past the 1-minute timeout so it fires. Never
      // settle the stream — the timeout is the only thing that resolves the run.
      await vi.advanceTimersByTimeAsync(60_000)

      await assertion
      expect(mockAbort).toHaveBeenCalledWith(buildAgentSessionTopicId('sess-new'), 'Task timed out after 1 minute(s)')
    } finally {
      vi.useRealTimers()
    }
  })
})
