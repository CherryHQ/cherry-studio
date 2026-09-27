import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useFilesystemMcpBaseDir } from './useFilesystemMcpBaseDir'
import * as useMcpServerModule from './useMcpServer'

describe('useFilesystemMcpBaseDir', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(useMcpServerModule, 'useMcpServerMutations').mockReturnValue({
      updateMcpServer: vi.fn(),
      removeMcpServer: vi.fn()
    } as unknown as ReturnType<typeof useMcpServerModule.useMcpServerMutations>)
  })

  it('should return no filesystem server when not found', () => {
    vi.spyOn(useMcpServerModule, 'useMcpServers').mockReturnValue({
      mcpServers: [],
      isLoading: false,
      addMcpServer: vi.fn(),
      reorderMcpServers: vi.fn(),
      refetch: vi.fn()
    } as unknown as ReturnType<typeof useMcpServerModule.useMcpServers>)

    const { result } = renderHook(() => useFilesystemMcpBaseDir())

    expect(result.current.filesystemServer).toBeUndefined()
    expect(result.current.baseDir).toBeUndefined()
  })

  it('should find filesystem server and extract baseDir', () => {
    const mockServer = {
      id: 'fs-server-1',
      name: '@cherry/filesystem',
      args: ['/home/user/projects'],
      isActive: true
    }

    vi.spyOn(useMcpServerModule, 'useMcpServers').mockReturnValue({
      mcpServers: [mockServer as never],
      isLoading: false,
      addMcpServer: vi.fn(),
      reorderMcpServers: vi.fn(),
      refetch: vi.fn()
    } as unknown as ReturnType<typeof useMcpServerModule.useMcpServers>)

    const { result } = renderHook(() => useFilesystemMcpBaseDir())

    expect(result.current.filesystemServer).toEqual(mockServer)
    expect(result.current.baseDir).toBe('/home/user/projects')
  })
})
