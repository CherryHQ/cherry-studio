/**
 * Phase 1 coverage: focuses on the pure branches that do not engage the
 * Claude Code subprocess (heartbeat skip + agent-not-found). The full
 * streaming path is exercised by integration tests / Phase 5 manual e2e.
 *
 * Each fire creates a fresh session — there is no cross-fire session reuse.
 */

import type { JobContext } from '@main/core/job/types'
import type { AgentEntity } from '@shared/data/api/schemas/agents'
import type { JobSnapshot } from '@shared/data/api/schemas/jobs'
import type { AgentSessionEntity } from '@shared/data/api/schemas/sessions'
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
vi.mock('@data/services/SessionService', () => ({
  sessionService: { createSession: vi.fn() }
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

import { agentService } from '@data/services/AgentService'
import { jobScheduleService } from '@data/services/JobScheduleService'
import { jobService } from '@data/services/JobService'
import { sessionService } from '@data/services/SessionService'
import { readHeartbeat } from '@main/ai/agents/cherryclaw/heartbeat'

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
    workspaceId: workspacePath ? 'ws-1' : null,
    workspace: workspacePath
      ? {
          id: 'ws-1',
          name: 'ws',
          path: workspacePath,
          orderKey: 'k',
          createdAt: '2026-05-20T00:00:00.000Z',
          updatedAt: '2026-05-20T00:00:00.000Z'
        }
      : null,
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
    vi.mocked(sessionService.createSession).mockReset()
    vi.mocked(readHeartbeat).mockReset()
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

  it('returns "Skipped (disabled)" when heartbeat task is disabled in agent config', async () => {
    vi.mocked(jobService.getById).mockResolvedValueOnce(makeJobSnapshot())
    vi.mocked(jobScheduleService.getById).mockResolvedValueOnce(makeSchedule('heartbeat'))
    vi.mocked(agentService.getAgent).mockResolvedValueOnce(makeAgent({ heartbeat_enabled: false }))
    vi.mocked(sessionService.createSession).mockResolvedValueOnce(makeSession())

    const out = await runAgentTask(makeCtx())

    expect(out).toEqual({ sessionId: 'sess-new', result: 'Skipped (disabled)' })
    expect(readHeartbeat).not.toHaveBeenCalled()
  })

  it('returns "Skipped (disabled)" when heartbeat task has no workspace', async () => {
    vi.mocked(jobService.getById).mockResolvedValueOnce(makeJobSnapshot())
    vi.mocked(jobScheduleService.getById).mockResolvedValueOnce(makeSchedule('heartbeat'))
    vi.mocked(agentService.getAgent).mockResolvedValueOnce(makeAgent({ heartbeat_enabled: true }))
    vi.mocked(sessionService.createSession).mockResolvedValueOnce(makeSession(null))

    const out = await runAgentTask(makeCtx())

    expect(out).toEqual({ sessionId: 'sess-new', result: 'Skipped (disabled)' })
    expect(readHeartbeat).not.toHaveBeenCalled()
  })

  it('returns "Skipped (no file)" when heartbeat.md is missing', async () => {
    vi.mocked(jobService.getById).mockResolvedValueOnce(makeJobSnapshot())
    vi.mocked(jobScheduleService.getById).mockResolvedValueOnce(makeSchedule('heartbeat'))
    vi.mocked(agentService.getAgent).mockResolvedValueOnce(makeAgent({ heartbeat_enabled: true }))
    vi.mocked(sessionService.createSession).mockResolvedValueOnce(makeSession('/ws/a'))
    vi.mocked(readHeartbeat).mockResolvedValueOnce(undefined)

    const out = await runAgentTask(makeCtx())

    expect(out).toEqual({ sessionId: 'sess-new', result: 'Skipped (no file)' })
    expect(readHeartbeat).toHaveBeenCalledWith('/ws/a')
  })

  it('always calls createSession (fresh session per fire — no reuse)', async () => {
    vi.mocked(jobService.getById).mockResolvedValueOnce(makeJobSnapshot())
    vi.mocked(jobScheduleService.getById).mockResolvedValueOnce(makeSchedule('heartbeat'))
    vi.mocked(agentService.getAgent).mockResolvedValueOnce(makeAgent({ heartbeat_enabled: false }))
    vi.mocked(sessionService.createSession).mockResolvedValueOnce(makeSession())

    await runAgentTask(makeCtx())

    expect(sessionService.createSession).toHaveBeenCalledWith({ agentId: 'a1', name: 'heartbeat' })
  })
})
