import type { McpServer } from '@shared/data/types/mcpServer'
import { describe, expect, it } from 'vitest'

import { resolveMcpPackageIconUrl } from '../mcpPackage'
import { isSameMcpServerCandidate, toCreateMcpServerDto, toUpdateMcpServerDto } from '../utils'

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
})
