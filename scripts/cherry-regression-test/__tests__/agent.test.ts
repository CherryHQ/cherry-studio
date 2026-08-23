import { assertAgentPreflightOutput, assertAgentTaskOutput, describeAgentFailure } from '../agent'

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

  it('describes bounded agent failures without exposing raw output', () => {
    const limits = { timeoutMinutes: 13 }

    expect(
      describeAgentFailure(
        {
          error: { message: 'spawnSync claude ETIMEDOUT' },
          signal: 'SIGTERM',
          status: null,
          stdout: ''
        },
        limits
      )
    ).toBe('timed out after 13 minutes')
    expect(
      describeAgentFailure(
        {
          signal: null,
          status: 1,
          stdout: JSON.stringify({ is_error: true, subtype: 'error_max_turns', num_turns: 51 })
        },
        limits
      )
    ).toBe('reached maximum number of turns (51)')
    expect(
      describeAgentFailure(
        {
          signal: null,
          status: 1,
          stdout: JSON.stringify({ is_error: true, errors: ['provider unavailable'] })
        },
        limits
      )
    ).toBe('returned an error: provider unavailable')
  })
})
