import { describe, expect, it } from 'vitest'

import { extractOutputMetadata, normalizeToolOutputResponse } from '../toolOutput'

describe('MCP output normalization', () => {
  it.each([undefined, { type: 'builtin' }, { type: 'mcp', serverName: 'documents' }])(
    'preserves result error and structured content independently of tool metadata: %j',
    (metadata) => {
      const output = {
        content: [{ type: 'text', text: 'Conversion failed' }],
        isError: true,
        structuredContent: { reason: 'invalid_source' },
        ...(metadata ? { metadata } : {})
      }
      expect(extractOutputMetadata(output).response).toEqual(output)
      expect(normalizeToolOutputResponse(output)).toEqual(output)
    }
  )

  it('unwraps application payloads without treating structured rows as MCP content', () => {
    const rows = [{ id: 'source-1', title: 'Reference' }]
    expect(normalizeToolOutputResponse({ content: rows, metadata: { type: 'mcp' } })).toEqual(rows)
  })
})
