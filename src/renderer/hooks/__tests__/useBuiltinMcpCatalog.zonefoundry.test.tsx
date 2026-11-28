import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { McpServer } from '@shared/data/types/mcpServer'
import { BuiltinMcpServerNames } from '@shared/utils/mcp'

const mocks = vi.hoisted(() => ({ servers: [] as McpServer[], add: vi.fn() }))
vi.mock('../useMcpServer', () => ({
  useMcpServers: () => ({
    mcpServers: mocks.servers,
    addMcpServer: mocks.add,
    isLoading: false,
    error: null,
    refetch: vi.fn()
  })
}))
vi.mock('@data/hooks/useDataApi', () => ({
  useMutation: () => ({ trigger: mocks.add })
}))
import { useBuiltinMcpCatalog } from '../useBuiltinMcpCatalog'

beforeEach(() => {
  mocks.servers = []
  mocks.add.mockReset()
})
describe('ZoneFoundry through the current builtin catalog', () => {
  it('installs once through the shared catalog without dropping inactive, untrusted or manual-approval fields', async () => {
    let resolve!: (server: McpServer) => void
    mocks.add.mockImplementation(
      () =>
        new Promise<McpServer>((done) => {
          resolve = done
        })
    )
    const { result } = renderHook(() => useBuiltinMcpCatalog())
    const preset = result.current.presets.find((server) => server.name === BuiltinMcpServerNames.zonefoundry)
    if (!preset) throw new Error('ZoneFoundry preset missing')
    let first!: Promise<McpServer>
    let second!: Promise<McpServer>
    act(() => {
      first = result.current.add(preset)
      second = result.current.add(preset)
    })
    expect(mocks.add).toHaveBeenCalledExactlyOnceWith({
      body: { name: BuiltinMcpServerNames.zonefoundry, activate: false }
    })
    expect(result.current.adding.has(preset.name)).toBe(true)
    const installed = { ...preset, id: 'installed-zonefoundry', installSource: 'builtin' as const }
    await act(async () => {
      resolve(installed)
      expect(await first).toEqual(installed)
      expect(await second).toEqual(installed)
    })
    expect(result.current.adding.has(preset.name)).toBe(false)
    mocks.servers = [installed]
    const { result: reloaded } = renderHook(() => useBuiltinMcpCatalog())
    expect(reloaded.current.findInstalled(preset)).toEqual(installed)
    expect(mocks.add).toHaveBeenCalledTimes(1)
  })
})
