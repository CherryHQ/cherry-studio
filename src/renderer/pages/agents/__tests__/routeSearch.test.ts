import { describe, expect, it } from 'vitest'

import { parseAgentRouteSearch } from '../routeSearch'

describe('parseAgentRouteSearch', () => {
  it('accepts the feedback intent alongside existing search fields', () => {
    expect(parseAgentRouteSearch({ intent: 'feedback', sessionId: 'session-1', view: 'message' })).toEqual({
      intent: 'feedback',
      sessionId: 'session-1',
      view: 'message'
    })
  })

  it('drops unknown intents', () => {
    expect(parseAgentRouteSearch({ intent: 'other' })).toEqual({
      intent: undefined,
      sessionId: undefined,
      view: undefined
    })
  })
})
