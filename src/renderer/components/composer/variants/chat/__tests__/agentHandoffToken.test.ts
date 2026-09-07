import { describe, expect, it } from 'vitest'

import {
  createAgentHandoffToken,
  findAgentHandoffToken,
  getAgentHandoffTokenPayload,
  isAgentHandoffToken
} from '../agentHandoffToken'

describe('agent handoff composer token boundary', () => {
  it('recognizes only the private handoff marker and preserves the target payload', () => {
    const token = createAgentHandoffToken({ id: 'a1', name: 'Reviewer', description: 'Reviews code' })
    expect(isAgentHandoffToken(token)).toBe(true)
    expect(getAgentHandoffTokenPayload(token)).toEqual({
      kind: 'agent-handoff',
      agentId: 'a1',
      name: 'Reviewer',
      description: 'Reviews code'
    })
    expect(findAgentHandoffToken([{ ...token, index: 0, textOffset: 0 }])).toBeTruthy()
  })

  it('leaves regular conversation references inert', () => {
    const reference = {
      id: 'reference:topic:t1',
      kind: 'reference' as const,
      label: 'Old topic',
      payload: { entityType: 'topic', id: 't1', name: 'Old topic' },
      index: 0,
      textOffset: 0
    }
    expect(isAgentHandoffToken(reference)).toBe(false)
    expect(getAgentHandoffTokenPayload(reference)).toBeNull()
    expect(findAgentHandoffToken([reference])).toBeNull()
  })

  it('does not treat plain @text as a target before the suggestion command inserts a token', () => {
    const draft = { text: '@Reviewer please inspect this', tokens: [] }
    expect(findAgentHandoffToken(draft.tokens)).toBeNull()
  })
})
