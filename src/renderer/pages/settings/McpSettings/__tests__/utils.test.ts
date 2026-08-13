import type { McpServer } from '@shared/data/types/mcpServer'
import type { McpServerLogEntry } from '@shared/types/mcp'
import { describe, expect, it, vi } from 'vitest'

import { resolveMcpPackageIconUrl } from '../mcpPackage'
import { formatMcpLogs, isSameMcpServerCandidate, toCreateMcpServerDto, toUpdateMcpServerDto } from '../utils'

describe('McpSettings utils', () => {
  it('matches provider candidates without using their transient id', () => {
    const existing: McpServer = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      name: 'Fetch',
      type: 'streamableHttp',
      baseUrl: 'https://example.com/mcp',
      provider: 'ModelScope',
      providerUrl: 'https://modelscope.cn/mcp/servers/fetch',
      isActive: true
    }

    const candidate: McpServer = {
      ...existing,
      id: '@modelscope/fetch'
    }

    expect(isSameMcpServerCandidate(existing, candidate)).toBe(true)
  })

  it('matches url candidates by baseUrl when provider is absent', () => {
    const existing: McpServer = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      name: 'Fetch',
      type: 'streamableHttp',
      baseUrl: 'https://example.com/mcp',
      isActive: true
    }

    const candidate: McpServer = {
      ...existing,
      id: '@302ai/fetch',
      provider: undefined
    }

    expect(isSameMcpServerCandidate(existing, candidate)).toBe(true)
  })

  it('removes readonly fields from create and update DTOs', () => {
    const createDto = toCreateMcpServerDto({
      id: '@provider/fetch',
      name: 'Fetch',
      url: 'https://example.com/mcp',
      createdAt: '2026-06-01T00:00:00.000Z',
      updatedAt: '2026-06-01T00:00:00.000Z',
      isActive: false
    })

    expect(createDto).toEqual({
      name: 'Fetch',
      baseUrl: 'https://example.com/mcp',
      isActive: false
    })

    const updateDto = toUpdateMcpServerDto({
      id: '550e8400-e29b-41d4-a716-446655440000',
      name: 'Fetch',
      createdAt: '2026-06-01T00:00:00.000Z',
      updatedAt: '2026-06-01T00:00:00.000Z',
      isActive: true
    })

    expect(updateDto).toEqual({
      name: 'Fetch',
      isActive: true
    })
  })

  it('preserves absolute package icon URLs and paths', () => {
    expect(resolveMcpPackageIconUrl('https://example.com/icon.png', '/tmp/server')).toBe('https://example.com/icon.png')
    expect(resolveMcpPackageIconUrl('http://example.com/icon.png', '/tmp/server')).toBe('http://example.com/icon.png')
    expect(resolveMcpPackageIconUrl('file:///tmp/icon.png', '/tmp/server')).toBe('file:///tmp/icon.png')
    expect(resolveMcpPackageIconUrl('/tmp/icon.png', '/tmp/server')).toBe('/tmp/icon.png')
    expect(resolveMcpPackageIconUrl('C:\\tmp\\icon.png', 'C:\\server')).toBe('C:\\tmp\\icon.png')
  })

  it('resolves relative package icon paths against the extraction directory', () => {
    expect(resolveMcpPackageIconUrl('assets/icon.png', '/tmp/server')).toBe('/tmp/server/assets/icon.png')
    expect(resolveMcpPackageIconUrl('assets/icon.png', '/tmp/server/')).toBe('/tmp/server/assets/icon.png')
  })

  it('rejects relative package icon paths that escape the extraction directory', () => {
    expect(resolveMcpPackageIconUrl('../secret.png', '/tmp/server')).toBeUndefined()
    expect(resolveMcpPackageIconUrl('assets/../../secret.png', '/tmp/server')).toBeUndefined()
    expect(resolveMcpPackageIconUrl('%2e%2e/secret.png', '/tmp/server')).toBeUndefined()
  })

  it('formats MCP logs into the copy-payload contract', () => {
    // `toLocaleTimeString()` output depends on the runner locale/timezone, so pin the
    // time segment and assert the fixed contract: `[HH:MM:SS] [LEVEL] message` plus
    // pretty-printed `data` (raw strings pass through) on the following lines.
    vi.spyOn(Date.prototype, 'toLocaleTimeString').mockReturnValue('22:13:20')

    const logs: McpServerLogEntry[] = [
      { timestamp: 1700000000000, level: 'info', message: 'Server started' },
      { timestamp: 1700000001000, level: 'error', message: 'Connection failed', data: { detail: 'timeout' } },
      { timestamp: 1700000002000, level: 'warn', message: 'raw line', data: 'plain output' }
    ]

    expect(formatMcpLogs(logs)).toBe(
      '[22:13:20] [INFO] Server started\n' +
        '[22:13:20] [ERROR] Connection failed\n{\n  "detail": "timeout"\n}\n' +
        '[22:13:20] [WARN] raw line\nplain output'
    )

    vi.restoreAllMocks()
  })
})
