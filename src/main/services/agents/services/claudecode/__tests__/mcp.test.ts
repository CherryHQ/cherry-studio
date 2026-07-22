import type { MCPServer } from '@types'
import { describe, expect, it, vi } from 'vitest'

import { filterReachableMcpServers } from '../mcp'

const server = (id: string, name = id): MCPServer => ({ id, name }) as MCPServer

describe('filterReachableMcpServers', () => {
  it('returns an empty list without probing when no servers are configured', async () => {
    const listServers = vi.fn()
    const checkConnectivity = vi.fn()

    await expect(filterReachableMcpServers([], { listServers, checkConnectivity })).resolves.toEqual([])
    expect(listServers).not.toHaveBeenCalled()
    expect(checkConnectivity).not.toHaveBeenCalled()
  })

  it('keeps every server when all are reachable', async () => {
    const result = await filterReachableMcpServers(['a', 'b'], {
      listServers: async () => [server('a'), server('b')],
      checkConnectivity: async () => true
    })

    expect(result).toEqual(['a', 'b'])
  })

  it('skips servers that fail the connectivity probe but keeps the rest', async () => {
    const result = await filterReachableMcpServers(['ok', 'bad'], {
      listServers: async () => [server('ok'), server('bad')],
      checkConnectivity: async (s) => s.id === 'ok'
    })

    expect(result).toEqual(['ok'])
  })

  it('skips ids that resolve to no configured server', async () => {
    const result = await filterReachableMcpServers(['known', 'ghost'], {
      listServers: async () => [server('known')],
      checkConnectivity: async () => true
    })

    expect(result).toEqual(['known'])
  })

  it('resolves servers addressed by name as well as id', async () => {
    const result = await filterReachableMcpServers(['my-server'], {
      listServers: async () => [server('uuid-1', 'my-server')],
      checkConnectivity: async () => true
    })

    expect(result).toEqual(['my-server'])
  })

  it('treats a probe that exceeds the timeout as unreachable', async () => {
    const result = await filterReachableMcpServers(['fast', 'hangs'], {
      listServers: async () => [server('fast'), server('hangs')],
      // 'hangs' never resolves; the timeout must win the race and skip it
      checkConnectivity: (s) => (s.id === 'fast' ? Promise.resolve(true) : new Promise<boolean>(() => {})),
      timeoutMs: 20
    })

    expect(result).toEqual(['fast'])
  })
})
