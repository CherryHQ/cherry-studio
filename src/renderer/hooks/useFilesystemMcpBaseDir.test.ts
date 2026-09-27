import { describe, it, expect, vi, beforeEach } from 'vitest'

import { useFilesystemMcpBaseDir } from './useFilesystemMcpBaseDir'
import * as useMcpServerModule from './useMcpServer'

describe('useFilesystemMcpBaseDir', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return null filesystem server when not found', () => {
    vi.spyOn(useMcpServerModule, 'useMcpServers').mockReturnValue({
      mcpServers: [],
      isLoading: false,
      addMcpServer: vi.fn(),
      reorderMcpServers: vi.fn(),
      refetch: vi.fn()
    })

    vi.spyOn(useMcpServerModule, 'useMcpServerMutations').mockReturnValue({
      updateMcpServer: vi.fn(),
      removeMcpServer: vi.fn()
    })

    const { result } = { result: useFilesystemMcpBaseDir() }
    expect(result.filesystemServer).toBeUndefined()
  })

  it('should find filesystem server and extract baseDir', () => {
    const mockServer = {
      id: 'fs-server-1',
      name: 'filesystem',
      args: ['/home/user/projects'],
      isActive: true
    }

    vi.spyOn(useMcpServerModule, 'useMcpServers').mockReturnValue({
      mcpServers: [mockServer as any],
      isLoading: false,
      addMcpServer: vi.fn(),
      reorderMcpServers: vi.fn(),
      refetch: vi.fn()
    })

    vi.spyOn(useMcpServerModule, 'useMcpServerMutations').mockReturnValue({
      updateMcpServer: vi.fn(),
      removeMcpServer: vi.fn()
    })

    const { result } = { result: useFilesystemMcpBaseDir() }
    expect(result.filesystemServer).toEqual(mockServer)
    expect(result.baseDir).toBe('/home/user/projects')
  })
})
