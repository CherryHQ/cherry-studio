import { describe, expect, it } from 'vitest'

import { CreateMCPServerSchema, UpdateMCPServerSchema } from '../mcpServers'

describe('MCP server DTO schemas', () => {
  it.each(['id', 'createdAt', 'updatedAt', 'url'])('rejects unknown or readonly create field %s', (key) => {
    expect(() =>
      CreateMCPServerSchema.parse({
        name: 'server',
        [key]: key === 'url' ? 'https://example.com/mcp' : 'value'
      })
    ).toThrow(/unrecognized/i)
  })

  it.each(['id', 'createdAt', 'updatedAt', 'url'])('rejects unknown or readonly update field %s', (key) => {
    expect(() =>
      UpdateMCPServerSchema.parse({
        name: 'server',
        [key]: key === 'url' ? 'https://example.com/mcp' : 'value'
      })
    ).toThrow(/unrecognized/i)
  })

  it('accepts writable create and update fields', () => {
    const create = CreateMCPServerSchema.parse({
      name: 'server',
      type: 'streamableHttp',
      baseUrl: 'https://example.com/mcp',
      isActive: false,
      tags: ['search'],
      headers: { Authorization: 'Bearer token' }
    })
    expect(create).toEqual({
      name: 'server',
      type: 'streamableHttp',
      baseUrl: 'https://example.com/mcp',
      isActive: false,
      tags: ['search'],
      headers: { Authorization: 'Bearer token' }
    })

    const update = UpdateMCPServerSchema.parse({
      isActive: true,
      disabledTools: ['tool']
    })
    expect(update).toEqual({
      isActive: true,
      disabledTools: ['tool']
    })
  })
})
