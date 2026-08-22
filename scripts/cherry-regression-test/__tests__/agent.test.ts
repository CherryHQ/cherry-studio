import { assertAgentPreflightOutput } from '../agent'

describe('test agent preflight', () => {
  it('accepts only the expected successful response', () => {
    expect(() =>
      assertAgentPreflightOutput(
        JSON.stringify({ is_error: false, result: 'CHERRY_TEST_AGENT_READY' }),
        'CHERRY_TEST_AGENT_READY'
      )
    ).not.toThrow()
    expect(() =>
      assertAgentPreflightOutput(JSON.stringify({ is_error: true, result: '' }), 'CHERRY_TEST_AGENT_READY')
    ).toThrow('Agent preflight returned an error result')
    expect(() =>
      assertAgentPreflightOutput(JSON.stringify({ is_error: false, result: 'unexpected' }), 'CHERRY_TEST_AGENT_READY')
    ).toThrow('Agent preflight returned an unexpected response')
  })
})
