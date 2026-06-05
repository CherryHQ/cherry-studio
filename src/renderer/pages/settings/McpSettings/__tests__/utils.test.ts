import type { McpServer } from '@shared/data/types/mcpServer'
import { describe, expect, it } from 'vitest'

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
})
