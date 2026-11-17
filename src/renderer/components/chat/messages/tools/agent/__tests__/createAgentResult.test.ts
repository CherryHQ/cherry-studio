import { describe, expect, it } from 'vitest'

import { parseCreateAgentResult } from '../createAgentResult'

const expected = { ok: true, agentId: 'agent-1', name: 'Researcher', model: 'provider::model' }

describe('create Agent result boundary', () => {
  it.each([
    expected,
    { structuredContent: expected },
    { data: expected },
    { details: expected },
    JSON.stringify(expected),
    [{ type: 'text', text: JSON.stringify(expected) }],
    {
      content: [
        { type: 'image', data: 'ignored' },
        { type: 'text', text: JSON.stringify(expected) }
      ]
    }
  ])('decodes supported transport envelopes into the result contract', (value) => {
    expect(parseCreateAgentResult(value)).toEqual(expected)
  })

  it('discards unrelated transport fields', () => {
    expect(parseCreateAgentResult({ ...expected, token: 'private-metadata' })).toEqual(expected)
  })

  it.each([
    null,
    'invalid JSON',
    { ...expected, ok: false },
    { ...expected, agentId: 1 },
    { ...expected, model: null },
    { ok: true, agentId: 'agent-1', name: 'Researcher' }
  ])('rejects malformed or incomplete results', (value) => {
    expect(parseCreateAgentResult(value)).toBeUndefined()
  })
})
