import { assertAgentPreflightOutput, assertAgentTaskOutput } from '../agent'

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

  it('rejects malformed and failed task results', () => {
    expect(() => assertAgentTaskOutput(JSON.stringify({ is_error: false, result: 'done' }))).not.toThrow()
    expect(() => assertAgentTaskOutput(JSON.stringify({ is_error: true, result: 'request failed' }))).toThrow(
      'Test agent task returned an error result'
    )
    expect(() => assertAgentTaskOutput('not json')).toThrow('Test agent did not return JSON')
    expect(() => assertAgentTaskOutput('{}')).toThrow('Test agent task returned an error result')
    expect(() => assertAgentTaskOutput('null')).toThrow('Test agent returned invalid JSON')
  })
})
