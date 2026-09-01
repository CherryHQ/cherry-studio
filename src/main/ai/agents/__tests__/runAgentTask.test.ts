/**
 * Phase 1 coverage: focuses on the pure branches that do not engage the
 * Claude Code subprocess (heartbeat skip + agent-not-found). The full
 * streaming path is exercised by integration tests / Phase 5 manual e2e.
 *
 * Each fire creates a fresh session unless the task opts into `reuseSession`,
 * whose sticky-pointer branches are covered in the 'session reuse' block.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { JobContext } from '@main/core/job/types'
import { DataApiErrorFactory } from '@shared/data/api/errors'
import type { AgentEntity } from '@shared/data/api/schemas/agents'
import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'
import type { AgentSessionWorkspaceSource } from '@shared/data/api/schemas/agentWorkspaces'
import type { JobSnapshot } from '@shared/data/api/schemas/jobs'

const {
  mockAbort,
  mockRemoveListener,
  mockGetAdapter,
  mockStartRun,
  mockBindTaskSessionReuse,
  mockIsSessionBusy,
  captured
} = vi.hoisted(() => {
  const captured: { listeners: Array<Record<string, (arg?: unknown) => void>> } = { listeners: [] }
  return {
    mockAbort: vi.fn(),
    mockRemoveListener: vi.fn(),
    mockGetAdapter: vi.fn(() => undefined),
    mockStartRun: vi.fn(async (opts: { listeners: typeof captured.listeners }) => {
      captured.listeners = opts.listeners
      return { mode: 'started' as const }
    }),
    mockBindTaskSessionReuse: vi.fn(() => true),
    mockIsSessionBusy: vi.fn(() => false),
    captured
  }
})

vi.mock('@application', async () => {
  const mod = await import('@test-mocks/main/application')
  return mod.mockApplicationFactory({
    // ChannelManager + AiStreamManager aren't in the default mock service set; the
    // streaming path (post heartbeat-skip) reads both, so wire minimal stubs here.
    ChannelManager: { getAdapter: mockGetAdapter },
    AiStreamManager: { abort: mockAbort, removeListener: mockRemoveListener },
    AgentJobsService: { bindTaskSessionReuse: mockBindTaskSessionReuse },
    // Gate that keeps a reusing fire off a session with a live turn.
    AgentSessionRuntimeService: { isSessionBusy: mockIsSessionBusy }
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
  agentSessionService: { create: vi.fn(), getByTaskScheduleId: vi.fn() }
}))
vi.mock('@data/services/AgentWorkspaceService', () => ({
  agentWorkspaceService: { getById: vi.fn() }
}))
vi.mock('@data/services/JobScheduleService', () => ({
  jobScheduleService: { getById: vi.fn(), getByIdTx: vi.fn() }
}))
vi.mock('@data/services/JobService', () => ({
  jobService: { getById: vi.fn() }
}))
vi.mock('@main/ai/agents/heartbeat', () => ({
  readHeartbeat: vi.fn()
}))

import { agentChannelService } from '@data/services/AgentChannelService'
import { agentService } from '@data/services/AgentService'
import { agentSessionService } from '@data/services/AgentSessionService'
import { agentWorkspaceService } from '@data/services/AgentWorkspaceService'
import { jobScheduleService } from '@data/services/JobScheduleService'
import { jobService } from '@data/services/JobService'
import { readHeartbeat } from '@main/ai/agents/heartbeat'
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
    cancelRequestedAt: null,
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
  reuseRevision: number
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
      reuseRevision: 0,
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
    orderKey: 'k',
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

function makeSchedule(name: string | null = 'heartbeat', metadata: Record<string, unknown> = {}) {
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
    metadata,
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
    vi.mocked(agentSessionService.getByTaskScheduleId).mockReset()
    vi.mocked(jobScheduleService.getByIdTx).mockReset()
    mockBindTaskSessionReuse.mockReset().mockReturnValue(true)
    mockIsSessionBusy.mockReset().mockReturnValue(false)
    vi.mocked(agentWorkspaceService.getById).mockReset()
    vi.mocked(readHeartbeat).mockReset()
    vi.mocked(agentChannelService.getSubscribedChannels).mockReset().mockReturnValue([])
    mockStartRun.mockClear()
    mockAbort.mockClear()
    mockRemoveListener.mockClear()
    mockGetAdapter.mockClear()
    captured.listeners = []
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('throws when the agent cannot be found', async () => {
    vi.mocked(jobService.getById).mockReturnValueOnce(makeJobSnapshot())
    vi.mocked(jobScheduleService.getById).mockReturnValueOnce(makeSchedule('heartbeat'))
    vi.mocked(agentService.getAgent).mockReturnValueOnce(null as never)

    await expect(runAgentTask(makeCtx())).rejects.toThrow('Agent not found: a1')
  })

  // A disabled heartbeat must short-circuit BEFORE createSession — that call also
  // lazily provisions a workspace on first fire, so creating a session for a fire
  // we're going to drop would accrete a session row (and workspace) every interval.
  it('skips a disabled heartbeat WITHOUT creating a session', async () => {
    vi.mocked(jobService.getById).mockReturnValueOnce(makeJobSnapshot())
    vi.mocked(jobScheduleService.getById).mockReturnValueOnce(makeSchedule('heartbeat'))
    vi.mocked(agentService.getAgent).mockReturnValueOnce(makeAgent({ heartbeat_enabled: false }))

    const out = await runAgentTask(makeCtx())

    expect(out).toEqual({ sessionId: null, result: 'Skipped (disabled)' })
    expect(agentSessionService.create).not.toHaveBeenCalled()
    expect(readHeartbeat).not.toHaveBeenCalled()
  })

  // v1 gave every agent a `heartbeat` task; v2's job_schedule is UNIQUE on (type, name), so
  // the migration renames all but the first to `task_<v1Id>` — still heartbeats, still gated.
  it('skips a disabled heartbeat whose schedule name the migration disambiguated', async () => {
    vi.mocked(jobService.getById).mockReturnValueOnce(makeJobSnapshot())
    vi.mocked(jobScheduleService.getById).mockReturnValueOnce(makeSchedule('task_hb-2'))
    vi.mocked(agentService.getAgent).mockReturnValueOnce(makeAgent({ heartbeat_enabled: false }))

    const out = await runAgentTask(makeCtx())

    expect(out).toEqual({ sessionId: null, result: 'Skipped (disabled)' })
    expect(agentSessionService.create).not.toHaveBeenCalled()
    expect(mockStartRun).not.toHaveBeenCalled()
  })

  // Same renamed schedule, heartbeat on: it must run heartbeat.md, not hand the raw
  // sentinel to the model (whose reply then reached every subscribed channel).
  it('runs a disambiguated heartbeat from heartbeat.md rather than the raw sentinel', async () => {
    vi.mocked(jobService.getById).mockReturnValueOnce(makeJobSnapshot())
    vi.mocked(jobScheduleService.getById).mockReturnValueOnce(makeSchedule('task_hb-2'))
    vi.mocked(agentService.getAgent).mockReturnValueOnce(makeAgent({ heartbeat_enabled: true }))
    vi.mocked(agentWorkspaceService.getById).mockReturnValueOnce({ id: 'ws-1', type: 'user', path: '/ws/a' } as never)
    vi.mocked(readHeartbeat).mockResolvedValueOnce('check the inbox')
    vi.mocked(agentSessionService.create).mockReturnValueOnce(makeSession('/ws/a'))

    const promise = runAgentTask(makeCtx())
    await vi.waitFor(() => expect(mockStartRun).toHaveBeenCalled())
    captured.listeners[0].onDone({ status: 'completed' })
    await promise

    expect(mockStartRun).toHaveBeenCalledWith(
      expect.objectContaining({
        userParts: [{ type: 'text', text: expect.stringContaining('check the inbox') }]
      })
    )
    expect(mockStartRun).not.toHaveBeenCalledWith(
      expect.objectContaining({ userParts: [{ type: 'text', text: '__heartbeat__' }] })
    )
  })

  it('treats a built-in Assistant heartbeat like any other Agent heartbeat', async () => {
    vi.mocked(jobService.getById).mockReturnValueOnce(makeJobSnapshot())
    vi.mocked(jobScheduleService.getById).mockReturnValueOnce(makeSchedule('heartbeat'))
    vi.mocked(agentService.getAgent).mockReturnValueOnce(
      makeAgent({ builtin_role: 'assistant', heartbeat_enabled: true })
    )

    const out = await runAgentTask(
      makeCtx({ input: { agentId: 'a1', prompt: '__heartbeat__', timeoutMinutes: 2, workspace: { type: 'system' } } })
    )

    expect(out).toEqual({ sessionId: null, result: 'Skipped (no file)' })
    expect(agentSessionService.create).not.toHaveBeenCalled()
    expect(agentWorkspaceService.getById).not.toHaveBeenCalled()
    expect(readHeartbeat).not.toHaveBeenCalled()
  })

  it('skips an enabled heartbeat with system workspace WITHOUT creating a session', async () => {
    vi.mocked(jobService.getById).mockReturnValueOnce(makeJobSnapshot())
    vi.mocked(jobScheduleService.getById).mockReturnValueOnce(makeSchedule('heartbeat'))
    vi.mocked(agentService.getAgent).mockReturnValueOnce(makeAgent({ heartbeat_enabled: true }))

    const out = await runAgentTask(
      makeCtx({ input: { agentId: 'a1', prompt: '__heartbeat__', timeoutMinutes: 2, workspace: { type: 'system' } } })
    )

    expect(out).toEqual({ sessionId: null, result: 'Skipped (no file)' })
    expect(agentSessionService.create).not.toHaveBeenCalled()
    expect(agentWorkspaceService.getById).not.toHaveBeenCalled()
    expect(readHeartbeat).not.toHaveBeenCalled()
  })

  it('skips an enabled heartbeat when its user workspace was deleted WITHOUT creating a session', async () => {
    vi.mocked(jobService.getById).mockReturnValueOnce(makeJobSnapshot())
    vi.mocked(jobScheduleService.getById).mockReturnValueOnce(makeSchedule('heartbeat'))
    vi.mocked(agentService.getAgent).mockReturnValueOnce(makeAgent({ heartbeat_enabled: true }))
    vi.mocked(agentWorkspaceService.getById).mockImplementationOnce(() => {
      throw DataApiErrorFactory.notFound('Workspace', 'ws-1')
    })

    const out = await runAgentTask(makeCtx())

    expect(out).toEqual({ sessionId: null, result: 'Skipped (workspace deleted)' })
    expect(agentSessionService.create).not.toHaveBeenCalled()
    expect(readHeartbeat).not.toHaveBeenCalled()
  })

  it('rejects an enabled heartbeat whose user source resolves to a system workspace', async () => {
    vi.mocked(jobService.getById).mockReturnValueOnce(makeJobSnapshot())
    vi.mocked(jobScheduleService.getById).mockReturnValueOnce(makeSchedule('heartbeat'))
    vi.mocked(agentService.getAgent).mockReturnValueOnce(makeAgent({ heartbeat_enabled: true }))
    vi.mocked(agentWorkspaceService.getById).mockReturnValueOnce({
      id: 'ws-1',
      type: 'system',
      path: '/ws/system'
    } as never)

    await expect(runAgentTask(makeCtx())).rejects.toThrow('Heartbeat workspace must be user-owned: ws-1')
    expect(agentSessionService.create).not.toHaveBeenCalled()
    expect(readHeartbeat).not.toHaveBeenCalled()
  })

  it('skips an enabled heartbeat with no heartbeat.md WITHOUT creating a session', async () => {
    vi.mocked(jobService.getById).mockReturnValueOnce(makeJobSnapshot())
    vi.mocked(jobScheduleService.getById).mockReturnValueOnce(makeSchedule('heartbeat'))
    vi.mocked(agentService.getAgent).mockReturnValueOnce(makeAgent({ heartbeat_enabled: true }))
    vi.mocked(agentWorkspaceService.getById).mockReturnValueOnce({ id: 'ws-1', type: 'user', path: '/ws/a' } as never)
    vi.mocked(readHeartbeat).mockResolvedValueOnce(undefined)

    const out = await runAgentTask(makeCtx())

    expect(out).toEqual({ sessionId: null, result: 'Skipped (no file)' })
    expect(agentSessionService.create).not.toHaveBeenCalled()
    expect(readHeartbeat).toHaveBeenCalledWith('/ws/a')
  })

  it('creates a session and runs when an enabled heartbeat has content', async () => {
    vi.mocked(jobService.getById).mockReturnValueOnce(makeJobSnapshot())
    vi.mocked(jobScheduleService.getById).mockReturnValueOnce(makeSchedule('heartbeat'))
    vi.mocked(agentService.getAgent).mockReturnValueOnce(makeAgent({ heartbeat_enabled: true }))
    vi.mocked(agentWorkspaceService.getById).mockReturnValueOnce({ id: 'ws-1', type: 'user', path: '/ws/a' } as never)
    vi.mocked(readHeartbeat).mockResolvedValueOnce('check the inbox')
    vi.mocked(agentSessionService.create).mockReturnValueOnce(makeSession('/ws/a'))

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
    // Scheduled runs have no interactive responder — the dispatch must be headless so AskUserQuestion
    // stays disallowed and the run can't stall on an approval prompt.
    expect(mockStartRun).toHaveBeenCalledWith(expect.objectContaining({ headless: true }))
  })

  // Regular tasks carry the workspace bound at creation time (system by
  // default, since the picker defaults there) straight through to the session.
  it('binds a non-heartbeat task to the workspace bound on the task', async () => {
    vi.mocked(jobService.getById).mockReturnValueOnce(makeJobSnapshot())
    vi.mocked(jobScheduleService.getById).mockReturnValueOnce(makeSchedule('daily-summary'))
    vi.mocked(agentService.getAgent).mockReturnValueOnce(makeAgent())
    vi.mocked(agentSessionService.create).mockReturnValueOnce(makeSession('/ws/a'))

    const promise = runAgentTask(
      makeCtx({ input: { agentId: 'a1', prompt: 'hi', timeoutMinutes: 0, workspace: { type: 'system' } } })
    )
    await vi.waitFor(() => expect(mockStartRun).toHaveBeenCalled())
    captured.listeners[0].onDone({ status: 'completed' })
    await promise

    expect(agentSessionService.create).toHaveBeenCalledWith({
      agentId: 'a1',
      name: 'daily-summary',
      workspace: { type: 'system' }
    })
  })

  describe('session reuse', () => {
    const REUSE_ON = { reuse: { enabled: true, revision: 0 } }

    /** Drive one fire of a non-heartbeat task to completion. */
    async function runToCompletion(scheduleMetadata: Record<string, unknown>) {
      vi.mocked(jobService.getById).mockReturnValueOnce(makeJobSnapshot('s1'))
      vi.mocked(jobScheduleService.getById).mockReturnValueOnce(makeSchedule('daily-summary', scheduleMetadata))
      vi.mocked(agentService.getAgent).mockReturnValueOnce(makeAgent())

      const promise = runAgentTask(
        makeCtx({ input: { agentId: 'a1', prompt: 'hi', timeoutMinutes: 0, workspace: { type: 'system' } } })
      )
      await vi.waitFor(() => expect(mockStartRun).toHaveBeenCalled())
      captured.listeners[0].onDone({ status: 'completed' })
      return await promise
    }

    it('creates a fresh session per fire and writes no pointer when reuse is off', async () => {
      vi.mocked(agentSessionService.create).mockReturnValueOnce(makeSession('/ws/a'))

      const out = await runToCompletion({})

      expect(out.sessionId).toBe('sess-new')
      expect(agentSessionService.getByTaskScheduleId).not.toHaveBeenCalled()
      expect(mockBindTaskSessionReuse).not.toHaveBeenCalled()
    })

    it('binds the created session onto the schedule on the first reusing fire', async () => {
      vi.mocked(agentSessionService.create).mockReturnValueOnce(makeSession('/ws/a'))

      const out = await runToCompletion(REUSE_ON)

      expect(out.sessionId).toBe('sess-new')
      expect(mockBindTaskSessionReuse).toHaveBeenCalledWith({
        scheduleId: 's1',
        sessionId: 'sess-new',
        agentId: 'a1',
        workspace: { type: 'system' },
        reuseRevision: 0
      })
    })

    it('continues the bound session on a later fire without creating one', async () => {
      const bound = { ...makeSession('/ws/a'), id: 'sess-sticky' }
      vi.mocked(agentSessionService.getByTaskScheduleId).mockReturnValueOnce(bound)

      const out = await runToCompletion({ reuse: { enabled: true, revision: 0 } })

      expect(out.sessionId).toBe('sess-sticky')
      expect(agentSessionService.create).not.toHaveBeenCalled()
      // Already bound — no pointer rewrite.
      expect(mockBindTaskSessionReuse).not.toHaveBeenCalled()
    })

    it('runs one-off when a queued job has a stale reuse revision', async () => {
      vi.mocked(jobService.getById).mockReturnValueOnce(makeJobSnapshot('s1'))
      vi.mocked(jobScheduleService.getById).mockReturnValueOnce(
        makeSchedule('daily-summary', { reuse: { enabled: true, revision: 1 } })
      )
      vi.mocked(agentService.getAgent).mockReturnValueOnce(makeAgent())
      vi.mocked(agentSessionService.create).mockReturnValueOnce(makeSession('/ws/a'))

      const promise = runAgentTask(
        makeCtx({
          input: { agentId: 'a1', prompt: 'hi', timeoutMinutes: 0, workspace: { type: 'system' }, reuseRevision: 0 }
        })
      )
      await vi.waitFor(() => expect(mockStartRun).toHaveBeenCalled())
      captured.listeners[0].onDone({ status: 'completed' })

      await expect(promise).resolves.toMatchObject({ sessionId: 'sess-new' })
      expect(agentSessionService.getByTaskScheduleId).not.toHaveBeenCalled()
      expect(mockBindTaskSessionReuse).not.toHaveBeenCalled()
    })

    // Deleting the session must not break the schedule: the fire rebinds a new one.
    it('rebinds when the constrained relation no longer has a session', async () => {
      vi.mocked(agentSessionService.getByTaskScheduleId).mockReturnValueOnce(null)
      vi.mocked(agentSessionService.create).mockReturnValueOnce(makeSession('/ws/a'))

      const out = await runToCompletion(REUSE_ON)

      expect(out.sessionId).toBe('sess-new')
      expect(mockBindTaskSessionReuse).toHaveBeenCalledTimes(1)
    })

    it('refuses to resume a session owned by another agent', async () => {
      vi.mocked(agentSessionService.getByTaskScheduleId).mockReturnValueOnce({ ...makeSession('/ws/a'), agentId: 'a2' })
      vi.mocked(agentSessionService.create).mockReturnValueOnce(makeSession('/ws/a'))

      const out = await runToCompletion(REUSE_ON)

      expect(out.sessionId).toBe('sess-new')
      expect(agentSessionService.create).toHaveBeenCalled()
    })

    it('delegates pointer admission to the command owner when reuse changes during the fire', async () => {
      vi.mocked(agentSessionService.create).mockReturnValueOnce(makeSession('/ws/a'))

      const out = await runToCompletion(REUSE_ON)

      expect(out.sessionId).toBe('sess-new')
      expect(mockBindTaskSessionReuse).toHaveBeenCalledTimes(1)
    })

    // The sticky session is user-reachable (the run log links to it). Dispatching
    // onto a live turn would attach this fire's sentinel to SOMEONE ELSE's stream:
    // the job would settle on their onDone, and a task timeout would abort their turn.
    it('stands down when the locked start reports a reused session busy', async () => {
      const bound = { ...makeSession('/ws/a'), id: 'sess-sticky' }
      vi.mocked(agentSessionService.getByTaskScheduleId).mockReturnValueOnce(bound)
      mockStartRun.mockResolvedValueOnce({ mode: 'not-started', reason: 'busy' } as never)

      vi.mocked(jobService.getById).mockReturnValueOnce(makeJobSnapshot('s1'))
      vi.mocked(jobScheduleService.getById).mockReturnValueOnce(makeSchedule('daily-summary', REUSE_ON))
      vi.mocked(agentService.getAgent).mockReturnValueOnce(makeAgent())

      const out = await runAgentTask(
        makeCtx({ input: { agentId: 'a1', prompt: 'hi', timeoutMinutes: 0, workspace: { type: 'system' } } })
      )

      expect(out).toEqual({ sessionId: 'sess-sticky', result: 'Skipped (session busy)' })
      expect(mockStartRun).toHaveBeenCalledWith(expect.objectContaining({ requireIdle: { expectedAgentId: 'a1' } }))
      expect(mockAbort).not.toHaveBeenCalled()
      expect(agentSessionService.create).not.toHaveBeenCalled()
    })

    // Skipping must not look like a failure: agentTaskJobHandler.onSettled pauses
    // the schedule after three consecutive failed runs, so a user chatting in the
    // sticky session could otherwise disable their own task.
    it('reports a busy skip as a completed run, not a throw', async () => {
      const bound = { ...makeSession('/ws/a'), id: 'sess-sticky' }
      vi.mocked(agentSessionService.getByTaskScheduleId).mockReturnValueOnce(bound)
      mockStartRun.mockResolvedValueOnce({ mode: 'not-started', reason: 'busy' } as never)

      vi.mocked(jobService.getById).mockReturnValueOnce(makeJobSnapshot('s1'))
      vi.mocked(jobScheduleService.getById).mockReturnValueOnce(makeSchedule('daily-summary', REUSE_ON))
      vi.mocked(agentService.getAgent).mockReturnValueOnce(makeAgent())

      await expect(
        runAgentTask(
          makeCtx({ input: { agentId: 'a1', prompt: 'hi', timeoutMinutes: 0, workspace: { type: 'system' } } })
        )
      ).resolves.toMatchObject({ result: 'Skipped (session busy)' })
    })

    it('starts a freshly created session through the locked require-idle path', async () => {
      vi.mocked(agentSessionService.create).mockReturnValueOnce(makeSession('/ws/a'))
      const out = await runToCompletion(REUSE_ON)

      expect(out.sessionId).toBe('sess-new')
      expect(mockStartRun).toHaveBeenCalledWith(expect.objectContaining({ requireIdle: { expectedAgentId: 'a1' } }))
    })

    // Ad-hoc enqueues carry no schedule, so there is nowhere to persist a pointer.
    it('does not attempt a pointer bind for a schedule-less job', async () => {
      vi.mocked(jobService.getById).mockReturnValueOnce(makeJobSnapshot(null))
      vi.mocked(agentService.getAgent).mockReturnValueOnce(makeAgent())
      vi.mocked(agentSessionService.create).mockReturnValueOnce(makeSession('/ws/a'))

      const promise = runAgentTask(
        makeCtx({ input: { agentId: 'a1', prompt: 'hi', timeoutMinutes: 0, workspace: { type: 'system' } } })
      )
      await vi.waitFor(() => expect(mockStartRun).toHaveBeenCalled())
      captured.listeners[0].onDone({ status: 'completed' })
      await promise

      expect(mockBindTaskSessionReuse).not.toHaveBeenCalled()
    })
  })

  // C1 (agents-jobs-3): a `text-delta` chunk's payload is on `.delta`, not `.text`.
  // The previous `as { text }` cast silently accumulated nothing, so every run
  // persisted the `'Completed'` fallback instead of the model's reply.
  it('accumulates text-delta chunks via .delta into the result', async () => {
    vi.mocked(jobService.getById).mockReturnValueOnce(makeJobSnapshot())
    vi.mocked(jobScheduleService.getById).mockReturnValueOnce(makeSchedule('daily-summary'))
    vi.mocked(agentService.getAgent).mockReturnValueOnce(makeAgent())
    vi.mocked(agentSessionService.create).mockReturnValueOnce(makeSession('/ws/a'))

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

  it('builds listeners only for subscribed channels owned by the task agent', async () => {
    vi.mocked(jobService.getById).mockReturnValueOnce(makeJobSnapshot('s1'))
    vi.mocked(jobScheduleService.getById).mockReturnValueOnce(makeSchedule('daily-summary'))
    vi.mocked(agentService.getAgent).mockReturnValueOnce(makeAgent())
    vi.mocked(agentSessionService.create).mockReturnValueOnce(makeSession('/ws/a'))
    vi.mocked(agentChannelService.getSubscribedChannels).mockReturnValueOnce([
      { id: 'ch-match', type: 'telegram', agentId: 'a1', isActive: true },
      { id: 'ch-foreign', type: 'telegram', agentId: 'a2', isActive: true }
    ] as never)

    const adapter = {
      channelId: 'ch-match',
      connected: true,
      notifyChatIds: ['chat-1'],
      sendMessage: vi.fn(async () => {}),
      onTextUpdate: vi.fn(async () => {}),
      onStreamComplete: vi.fn(async () => true)
    }
    mockGetAdapter.mockReturnValue(adapter as never)

    const promise = runAgentTask(makeCtx({ input: { agentId: 'a1', prompt: 'hi', timeoutMinutes: 0 } }))

    await vi.waitFor(() => expect(mockStartRun).toHaveBeenCalled())
    captured.listeners[0].onDone({ status: 'completed' })
    await promise

    expect(mockGetAdapter).toHaveBeenCalledTimes(1)
    expect(mockGetAdapter).toHaveBeenCalledWith('ch-match')
    expect(captured.listeners).toHaveLength(2)
  })

  // The stream manager snapshots listeners then invokes every onDone. The task sentinel
  // must not fan the same terminal event out again — that double-delivers one cron result.
  it('delivers a successful cron result to a subscribed channel exactly once', async () => {
    vi.mocked(jobService.getById).mockReturnValueOnce(makeJobSnapshot('s1'))
    vi.mocked(jobScheduleService.getById).mockReturnValueOnce(makeSchedule('daily-summary'))
    vi.mocked(agentService.getAgent).mockReturnValueOnce(makeAgent())
    vi.mocked(agentSessionService.create).mockReturnValueOnce(makeSession('/ws/a'))
    vi.mocked(agentChannelService.getSubscribedChannels).mockReturnValueOnce([
      { id: 'ch1', type: 'telegram', agentId: 'a1', isActive: true }
    ] as never)

    const adapter = {
      channelId: 'ch1',
      connected: true,
      notifyChatIds: ['chat-1'],
      sendMessage: vi.fn<(chatId: string, text: string) => Promise<void>>(async () => {}),
      onTextUpdate: vi.fn(async () => {}),
      onStreamComplete: vi.fn(async () => false)
    }
    mockGetAdapter.mockReturnValue(adapter as never)

    const promise = runAgentTask(makeCtx({ input: { agentId: 'a1', prompt: 'hi', timeoutMinutes: 0 } }))

    await vi.waitFor(() => expect(mockStartRun).toHaveBeenCalled())
    const chunk = { type: 'text-delta', delta: 'daily summary' }
    for (const listener of captured.listeners) {
      listener.onChunk?.(chunk)
    }
    const doneResult = { status: 'success' }
    await Promise.all(captured.listeners.map((listener) => Promise.resolve(listener.onDone?.(doneResult as never))))

    await expect(promise).resolves.toEqual({ sessionId: 'sess-new', result: 'daily summary' })
    expect(adapter.sendMessage).toHaveBeenCalledTimes(1)
    expect(adapter.sendMessage).toHaveBeenCalledWith('chat-1', 'daily summary', undefined)
    expect(adapter.onStreamComplete).toHaveBeenCalledTimes(1)
  })

  it('delivers a paused cron result to a subscribed channel exactly once', async () => {
    vi.mocked(jobService.getById).mockReturnValueOnce(makeJobSnapshot('s1'))
    vi.mocked(jobScheduleService.getById).mockReturnValueOnce(makeSchedule('daily-summary'))
    vi.mocked(agentService.getAgent).mockReturnValueOnce(makeAgent())
    vi.mocked(agentSessionService.create).mockReturnValueOnce(makeSession('/ws/a'))
    vi.mocked(agentChannelService.getSubscribedChannels).mockReturnValueOnce([
      { id: 'ch1', type: 'telegram', agentId: 'a1', isActive: true }
    ] as never)

    const adapter = {
      channelId: 'ch1',
      connected: true,
      notifyChatIds: ['chat-1'],
      sendMessage: vi.fn<(chatId: string, text: string) => Promise<void>>(async () => {}),
      onTextUpdate: vi.fn(async () => {}),
      onStreamComplete: vi.fn(async () => false)
    }
    mockGetAdapter.mockReturnValue(adapter as never)

    const promise = runAgentTask(makeCtx({ input: { agentId: 'a1', prompt: 'hi', timeoutMinutes: 0 } }))

    await vi.waitFor(() => expect(mockStartRun).toHaveBeenCalled())
    const chunk = { type: 'text-delta', delta: 'partial summary' }
    for (const listener of captured.listeners) {
      listener.onChunk?.(chunk)
    }
    const pausedResult = { status: 'paused' }
    await Promise.all(captured.listeners.map((listener) => Promise.resolve(listener.onPaused?.(pausedResult as never))))

    await expect(promise).resolves.toEqual({ sessionId: 'sess-new', result: 'partial summary' })
    expect(adapter.sendMessage).toHaveBeenCalledTimes(1)
    expect(adapter.sendMessage).toHaveBeenCalledWith('chat-1', 'partial summary\n\n_(stopped)_', undefined)
    expect(adapter.onStreamComplete).toHaveBeenCalledTimes(1)
  })

  it.each([
    [
      'owned configured recipients, including offline or inactive channels',
      [
        { id: 'ch-offline', type: 'feishu', agentId: 'a1', isActive: true },
        { id: 'ch-inactive', type: 'telegram', agentId: 'a1', isActive: false },
        { id: 'ch-foreign', type: 'telegram', agentId: 'a2', isActive: true }
      ],
      [
        { id: 'ch-inactive', type: 'telegram' },
        { id: 'ch-offline', type: 'feishu' }
      ]
    ],
    ['an explicit empty recipient set', [], []]
  ])('passes %s as notification authority', async (_case, subscribedChannels, trustedNotifyChannels) => {
    vi.mocked(jobService.getById).mockReturnValueOnce(makeJobSnapshot('s1'))
    vi.mocked(jobScheduleService.getById).mockReturnValueOnce(makeSchedule('daily-summary'))
    vi.mocked(agentService.getAgent).mockReturnValueOnce(makeAgent())
    vi.mocked(agentSessionService.create).mockReturnValueOnce(makeSession('/ws/a'))
    vi.mocked(agentChannelService.getSubscribedChannels).mockReturnValueOnce(subscribedChannels as never)
    mockGetAdapter.mockReturnValue(undefined)

    const promise = runAgentTask(makeCtx({ input: { agentId: 'a1', prompt: 'hi', timeoutMinutes: 0 } }))
    await vi.waitFor(() => expect(mockStartRun).toHaveBeenCalled())
    captured.listeners[0].onDone({ status: 'completed' })
    await promise

    expect(mockStartRun).toHaveBeenCalledWith(expect.objectContaining({ trustedNotifyChannels }))
  })

  // agents-jobs-4: on a non-abort error, a subscribed channel must be notified exactly
  // once. The channel listener's generic `Error: …` is suppressed for task runs so only
  // the richer `[Task failed]` summary from notifyTaskError is delivered (no double-send).
  it('notifies a subscribed channel exactly once on a non-abort run error', async () => {
    vi.mocked(jobService.getById).mockReturnValueOnce(makeJobSnapshot('s1'))
    vi.mocked(jobScheduleService.getById).mockReturnValueOnce(makeSchedule('daily-summary'))
    vi.mocked(agentService.getAgent).mockReturnValueOnce(makeAgent())
    vi.mocked(agentSessionService.create).mockReturnValueOnce(makeSession('/ws/a'))
    vi.mocked(agentChannelService.getSubscribedChannels).mockReturnValueOnce([
      { id: 'ch1', type: 'telegram', agentId: 'a1', isActive: true }
    ] as never)

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
    vi.mocked(jobService.getById).mockReturnValueOnce(makeJobSnapshot('s1'))
    vi.mocked(jobScheduleService.getById).mockReturnValueOnce(makeSchedule('daily-summary'))
    vi.mocked(agentService.getAgent).mockReturnValueOnce(makeAgent())
    vi.mocked(agentSessionService.create).mockReturnValueOnce(makeSession('/ws/a'))
    vi.mocked(agentChannelService.getSubscribedChannels).mockReturnValueOnce([
      { id: 'ch1', type: 'telegram', agentId: 'a1', isActive: true }
    ] as never)

    const adapter = {
      channelId: 'ch1',
      connected: true,
      notifyChatIds: ['chat-1'],
      sendMessage: vi.fn<(chatId: string, text: string) => Promise<void>>(async () => {}),
      onTextUpdate: vi.fn(async () => {}),
      onStreamComplete: vi.fn(async () => false)
    }
    mockGetAdapter.mockReturnValue(adapter as never)

    const controller = new AbortController()
    const promise = runAgentTask(
      makeCtx({ signal: controller.signal, input: { agentId: 'a1', prompt: 'hi', timeoutMinutes: 0 } })
    )

    await vi.waitFor(() => expect(mockStartRun).toHaveBeenCalled())
    for (const listener of captured.listeners) {
      listener.onChunk?.({ type: 'text-delta', delta: 'partial summary' })
    }
    controller.abort(new Error('cancelled by manager'))

    await expect(promise).rejects.toThrow('cancelled by manager')
    expect(mockAbort).toHaveBeenCalledWith(buildAgentSessionTopicId('sess-new'), 'cancelled by manager')
    expect(adapter.onStreamComplete).not.toHaveBeenCalled()
    expect(adapter.sendMessage).not.toHaveBeenCalled()
  })

  it('does not abort a queued successor after this task terminal listener has settled', async () => {
    vi.mocked(jobService.getById).mockReturnValueOnce(makeJobSnapshot())
    vi.mocked(jobScheduleService.getById).mockReturnValueOnce(makeSchedule('daily-summary'))
    vi.mocked(agentService.getAgent).mockReturnValueOnce(makeAgent())
    vi.mocked(agentSessionService.create).mockReturnValueOnce(makeSession('/ws/a'))
    const controller = new AbortController()
    mockStartRun.mockImplementationOnce(async (opts) => {
      opts.listeners[0].onDone({ status: 'completed' } as never)
      // This models the runtime terminal listener scheduling a successor immediately after the
      // task listener. A late timeout/cancel must no longer abort the topic.
      controller.abort(new Error('late timeout'))
      return { mode: 'started' }
    })

    await expect(
      runAgentTask(makeCtx({ signal: controller.signal, input: { agentId: 'a1', prompt: 'hi', timeoutMinutes: 0 } }))
    ).resolves.toEqual({ sessionId: 'sess-new', result: 'Completed' })

    expect(mockAbort).not.toHaveBeenCalled()
    expect(mockRemoveListener).toHaveBeenCalledWith(buildAgentSessionTopicId('sess-new'), 'agent-task:s1')
  })

  it('does not abort a user turn when cancellation lands while idle admission is waiting', async () => {
    vi.mocked(jobService.getById).mockReturnValueOnce(makeJobSnapshot())
    vi.mocked(jobScheduleService.getById).mockReturnValueOnce(makeSchedule('daily-summary'))
    vi.mocked(agentService.getAgent).mockReturnValueOnce(makeAgent())
    vi.mocked(agentSessionService.create).mockReturnValueOnce(makeSession('/ws/a'))
    const controller = new AbortController()
    let finishAdmission!: () => void
    mockStartRun.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishAdmission = () => resolve({ mode: 'not-started', reason: 'busy' } as never)
        })
    )

    const promise = runAgentTask(
      makeCtx({ signal: controller.signal, input: { agentId: 'a1', prompt: 'hi', timeoutMinutes: 0 } })
    )
    await vi.waitFor(() => expect(mockStartRun).toHaveBeenCalled())
    controller.abort(new Error('cancelled while waiting'))
    finishAdmission()

    await expect(promise).rejects.toThrow('cancelled while waiting')
    expect(mockAbort).not.toHaveBeenCalled()
  })

  it('rebinds once after an ownership race and starts only the replacement session', async () => {
    vi.mocked(jobService.getById).mockReturnValueOnce(makeJobSnapshot())
    vi.mocked(jobScheduleService.getById).mockReturnValueOnce(makeSchedule('daily-summary'))
    vi.mocked(agentService.getAgent).mockReturnValueOnce(makeAgent())
    vi.mocked(agentSessionService.create)
      .mockReturnValueOnce({ ...makeSession('/ws/a'), id: 'sess-stale' })
      .mockReturnValueOnce({ ...makeSession('/ws/a'), id: 'sess-rebound' })
    mockStartRun
      .mockResolvedValueOnce({ mode: 'not-started', reason: 'session-invalid' } as never)
      .mockImplementationOnce(async (opts) => {
        captured.listeners = opts.listeners
        return { mode: 'started' }
      })

    const promise = runAgentTask(makeCtx({ input: { agentId: 'a1', prompt: 'hi', timeoutMinutes: 0 } }))
    await vi.waitFor(() => expect(mockStartRun).toHaveBeenCalledTimes(2))
    captured.listeners[0].onDone({ status: 'completed' })

    await expect(promise).resolves.toMatchObject({ sessionId: 'sess-rebound' })
    expect(agentSessionService.create).toHaveBeenCalledTimes(2)
  })

  // agents-jobs-5: a non-zero `timeoutMinutes` arms a per-task timeout timer in
  // makeRunSignal. When the stream never settles, the timer must fire, abort the
  // upstream stream, and reject the handler with the timeout error.
  it('aborts the upstream stream and rejects when the per-task timeout fires', async () => {
    vi.useFakeTimers()
    try {
      vi.mocked(jobService.getById).mockReturnValueOnce(makeJobSnapshot())
      vi.mocked(jobScheduleService.getById).mockReturnValueOnce(makeSchedule('daily-summary'))
      vi.mocked(agentService.getAgent).mockReturnValueOnce(makeAgent())
      vi.mocked(agentSessionService.create).mockReturnValueOnce(makeSession('/ws/a'))

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
