import type * as MainFileUtils from '@main/utils/file'
import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  ensureAgentStorageDirectory: vi.fn(),
  getPathStatus: vi.fn(),
  t: vi.fn((key: string, options?: { path?: string }) => `${key}:${options?.path ?? ''}`)
}))

vi.mock('@application', () => ({ application: { getPath: vi.fn() } }))
vi.mock('@logger', () => ({
  loggerService: { withContext: () => ({ warn: vi.fn() }) }
}))
vi.mock('@main/ai/agents/agentDataDirectory', () => ({
  ensureAgentStorageDirectory: mocks.ensureAgentStorageDirectory
}))
vi.mock('@main/i18n', () => ({ t: mocks.t }))
vi.mock('@main/utils/file', async (importActual) => ({
  ...(await importActual<typeof MainFileUtils>()),
  getPathStatus: mocks.getPathStatus
}))

const { AgentSessionWorkspaceError, prepareAgentSessionWorkspaceDirectory } = await import('./agentSessionWorkspace')

function userSession(workspacePath: string): AgentSessionEntity {
  return {
    id: 'session-1',
    workspace: { id: 'workspace-1', path: workspacePath, type: 'user' }
  } as AgentSessionEntity
}

describe('prepareAgentSessionWorkspaceDirectory', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getPathStatus.mockResolvedValue({ ok: true, kind: 'directory' })
  })

  it.each(['/', '/./', '/tmp/..'])(
    'blocks a persisted user workspace that resolves to the filesystem root before probing it: %s',
    async (workspacePath) => {
      const promise = prepareAgentSessionWorkspaceDirectory(userSession(workspacePath))

      await expect(promise).rejects.toBeInstanceOf(AgentSessionWorkspaceError)
      await expect(promise).rejects.toMatchObject({
        message: `agent.session.workspace_status.filesystem_root:${workspacePath}`,
        retryable: false
      })
      expect(mocks.getPathStatus).not.toHaveBeenCalled()
    }
  )

  it('allows a normal nested workspace directory', async () => {
    await expect(prepareAgentSessionWorkspaceDirectory(userSession('/tmp/project'))).resolves.toBeUndefined()

    expect(mocks.getPathStatus).toHaveBeenCalledWith('/tmp/project')
  })
})
