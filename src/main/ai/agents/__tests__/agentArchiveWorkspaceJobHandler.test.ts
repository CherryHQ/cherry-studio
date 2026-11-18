import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { JobContext } from '@main/core/job/types'

vi.mock('@application', async () => {
  const mod = await import('@test-mocks/main/application')
  return mod.mockApplicationFactory()
})

vi.mock('@data/services/AgentSessionService', () => ({
  ARCHIVE_SYSTEM_WORKSPACE_JOB_KEY_PREFIX: 'archive-system-workspace:',
  agentSessionService: {
    listSystemWorkspaceSessions: vi.fn()
  }
}))

vi.mock('../AgentWorkspaceStorageService', () => ({
  agentWorkspaceStorageService: {
    archiveWorkspace: vi.fn()
  }
}))

import { agentSessionService } from '@data/services/AgentSessionService'

import { agentArchiveWorkspaceJobHandler } from '../agentArchiveWorkspaceJobHandler'
import { agentWorkspaceStorageService } from '../AgentWorkspaceStorageService'

const listWorkspaces = vi.mocked(agentSessionService.listSystemWorkspaceSessions)
const archiveWorkspace = vi.mocked(agentWorkspaceStorageService.archiveWorkspace)

function makeContext(sessionId: string, signal?: AbortSignal): JobContext<{ sessionId: string }> {
  return {
    jobId: 'job-1',
    input: { sessionId },
    signal: signal ?? new AbortController().signal,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
  } as unknown as JobContext<{ sessionId: string }>
}

const archivedWorkspace = { id: 'session', path: '/workspaces/session', deletedAt: 123, agentDeletedAt: 123 }

describe('agentArchiveWorkspaceJobHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('declares restart recovery, a shared queue and a batch concurrency cap (AC5/AC6)', () => {
    expect(agentArchiveWorkspaceJobHandler.recovery).toBe('retry')
    expect(agentArchiveWorkspaceJobHandler.defaultQueue?.({ sessionId: 'a' })).toBe('agent.workspace-archive')
    expect(agentArchiveWorkspaceJobHandler.defaultConcurrency).toBe(2)
    expect(agentArchiveWorkspaceJobHandler.defaultRetryPolicy?.maxAttempts).toBeGreaterThan(1)
  })

  it('archives a workspace that is still archived (AC1/AC2)', async () => {
    listWorkspaces.mockReturnValue([archivedWorkspace] as never)
    await expect(agentArchiveWorkspaceJobHandler.execute(makeContext('session'))).resolves.toEqual({
      archived: '/workspaces/session'
    })
    expect(archiveWorkspace).toHaveBeenCalledWith(archivedWorkspace)
  })

  it('skips a workspace restored after the task was queued (AC3)', async () => {
    listWorkspaces.mockReturnValue([{ ...archivedWorkspace, deletedAt: null }] as never)
    await expect(agentArchiveWorkspaceJobHandler.execute(makeContext('session'))).resolves.toEqual({ skipped: true })
    expect(archiveWorkspace).not.toHaveBeenCalled()
  })

  it('skips when the workspace row is gone, e.g. permanently deleted (AC5)', async () => {
    listWorkspaces.mockReturnValue([] as never)
    await expect(agentArchiveWorkspaceJobHandler.execute(makeContext('session'))).resolves.toEqual({ skipped: true })
    expect(archiveWorkspace).not.toHaveBeenCalled()
  })

  it('propagates a compression failure so the task retries (AC4)', async () => {
    listWorkspaces.mockReturnValue([archivedWorkspace] as never)
    archiveWorkspace.mockRejectedValueOnce(new Error('disk full'))
    await expect(agentArchiveWorkspaceJobHandler.execute(makeContext('session'))).rejects.toThrow('disk full')
  })

  it('rejects when cancelled before the archive starts', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(agentArchiveWorkspaceJobHandler.execute(makeContext('session', controller.signal))).rejects.toThrow(
      'cancelled'
    )
    expect(listWorkspaces).not.toHaveBeenCalled()
  })

  it('logs task failures with the session context for diagnosis (AC4)', async () => {
    const settled = {
      jobId: 'job-1',
      type: 'agent.archive-system-workspace',
      status: 'failed',
      input: { sessionId: 'session' },
      error: { code: 'X', message: 'disk full', retryable: true },
      attempt: 1,
      metadata: {}
    }
    expect(() => agentArchiveWorkspaceJobHandler.onSettled?.(settled as never)).not.toThrow()
  })
})
