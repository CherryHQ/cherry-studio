import { describe, expect, it } from 'vitest'

import { CreateMcpServerSchema, UpdateMcpServerSchema } from '../mcpServers'

describe('MCP server DTO schemas', () => {
  it.each(['id', 'createdAt', 'updatedAt', 'url'])('rejects unknown or readonly create field %s', (key) => {
    expect(() =>
      CreateMcpServerSchema.parse({
        name: 'server',
        [key]: key === 'url' ? 'https://example.com/mcp' : 'value'
      })
    ).toThrow(/unrecognized/i)
  })

  it.each(['id', 'createdAt', 'updatedAt', 'url'])('rejects unknown or readonly update field %s', (key) => {
    expect(() =>
      UpdateMcpServerSchema.parse({
        name: 'server',
        [key]: key === 'url' ? 'https://example.com/mcp' : 'value'
      })
    ).toThrow(/unrecognized/i)
  })

  it('accepts writable create and update fields', () => {
    const create = CreateMcpServerSchema.parse({
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

    const update = UpdateMcpServerSchema.parse({
      isActive: true,
      disabledTools: ['tool']
    })
    expect(update).toEqual({
      isActive: true,
      disabledTools: ['tool']
    })
  })
})
