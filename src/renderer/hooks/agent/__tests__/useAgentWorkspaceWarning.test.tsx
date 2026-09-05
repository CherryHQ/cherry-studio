import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ ipcRequest: vi.fn() }))

vi.mock('@logger', () => ({
  loggerService: { withContext: () => ({ warn: vi.fn() }) }
}))
vi.mock('@renderer/ipc', () => ({ ipcApi: { request: mocks.ipcRequest } }))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, options: { path: string }) => `${key}:${options.path}` })
}))

const { useAgentWorkspaceWarning } = await import('../useAgentWorkspaceWarning')

describe('useAgentWorkspaceWarning', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.ipcRequest.mockResolvedValue({ kind: 'directory' })
  })

  it('reports an actionable warning for a filesystem root without probing its metadata', async () => {
    const { result } = renderHook(() => useAgentWorkspaceWarning('/tmp/..'))

    await waitFor(() => {
      expect(result.current).toBe('agent.session.workspace_status.filesystem_root:/tmp/..')
    })
    expect(mocks.ipcRequest).not.toHaveBeenCalled()
  })

  it('continues checking a normal nested workspace', async () => {
    const { result } = renderHook(() => useAgentWorkspaceWarning('/tmp/project'))

    await waitFor(() => expect(mocks.ipcRequest).toHaveBeenCalledOnce())
    expect(result.current).toBeUndefined()
  })
})
