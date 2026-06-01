import { describe, expect, it } from 'vitest'

import { CreateMCPServerSchema, stripReadOnlyMCPServerFields, UpdateMCPServerSchema } from '../mcpServers'

const SERVER_ID = '00000000-0000-4000-8000-000000000000'

describe('MCP server schemas', () => {
  it.each([CreateMCPServerSchema, UpdateMCPServerSchema])('rejects read-only fields at the API boundary', (schema) => {
    expect(() => schema.parse({ id: SERVER_ID, name: '@cherry/fetch' })).toThrow(/unrecognized/i)
  })

  it('strips read-only fields before renderer mutations send DTO bodies', () => {
    const stripped = stripReadOnlyMCPServerFields({
      id: SERVER_ID,
      name: '@cherry/fetch',
      isActive: true,
      createdAt: '2026-06-01T00:00:00.000Z',
      updatedAt: '2026-06-01T00:00:00.000Z'
    })

    expect(stripped).toEqual({
      name: '@cherry/fetch',
      isActive: true
    })
    expect(CreateMCPServerSchema.parse(stripped)).toEqual(stripped)
  })
})
