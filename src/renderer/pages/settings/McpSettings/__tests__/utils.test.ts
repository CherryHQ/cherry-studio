import { describe, expect, it, vi } from 'vitest'

import { resolveMcpPackageIconUrl } from '@renderer/components/mcp/mcpPackage'
import { isSameMcpServerCandidate } from '@renderer/utils/mcpDiscovery'
import type { McpServer } from '@shared/data/types/mcpServer'
import type { McpServerLogEntry } from '@shared/types/mcp'

import { ensureServerTrusted, formatMcpLogs, toCreateMcpServerDto, toUpdateMcpServerDto } from '../utils'

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

  describe('ensureServerTrusted', () => {
    it('requires confirmation for manually imported servers with isTrusted: false and preserves installSource', async () => {
      const server: McpServer = {
        id: 'manual-untrusted',
        name: 'Imported Stdio',
        type: 'stdio',
        command: 'npx',
        args: ['-y', 'demo'],
        installSource: 'manual',
        isActive: false,
        isTrusted: false
      }
      const updateServer = vi.fn()

      const declined = await ensureServerTrusted(server, vi.fn().mockResolvedValue(false), updateServer)
      expect(declined).toBeNull()
      expect(updateServer).not.toHaveBeenCalled()

      const approved = await ensureServerTrusted(server, vi.fn().mockResolvedValue(true), updateServer)
      expect(approved).toMatchObject({
        id: 'manual-untrusted',
        installSource: 'manual',
        isTrusted: true,
        trustedAt: expect.any(Number)
      })
      expect(updateServer).toHaveBeenCalledWith({
        installSource: 'manual',
        isTrusted: true,
        trustedAt: expect.any(Number)
      })
    })

    it('keeps protocol-link trust and whitelist behavior unchanged', async () => {
      const whitelisted: McpServer = {
        id: 'protocol-wps',
        name: 'WPS Notes',
        type: 'streamableHttp',
        baseUrl: 'http://127.0.0.1:18930/mcp',
        installSource: 'protocol',
        isActive: false,
        isTrusted: false
      }
      const requestConfirm = vi.fn().mockResolvedValue(false)
      const updateServer = vi.fn()

      const autoTrusted = await ensureServerTrusted(whitelisted, requestConfirm, updateServer)
      expect(requestConfirm).not.toHaveBeenCalled()
      expect(autoTrusted).toMatchObject({ installSource: 'protocol', isTrusted: true })
      expect(updateServer).toHaveBeenCalledWith(expect.objectContaining({ installSource: 'protocol', isTrusted: true }))
    })

    it('does not prompt for legacy manual servers without explicit isTrusted: false', async () => {
      const legacy: McpServer = {
        id: 'legacy-manual',
        name: 'Legacy',
        type: 'stdio',
        command: 'node',
        installSource: 'manual',
        isActive: false
      }
      const requestConfirm = vi.fn().mockResolvedValue(false)
      const updateServer = vi.fn()

      const result = await ensureServerTrusted(legacy, requestConfirm, updateServer)
      expect(result).toBe(legacy)
      expect(requestConfirm).not.toHaveBeenCalled()
      expect(updateServer).not.toHaveBeenCalled()
    })
  })
})
