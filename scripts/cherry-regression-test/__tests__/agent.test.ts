import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  assertAgentPreflightOutput,
  assertAgentTaskOutput,
  buildTaskSkillInstructions,
  describeAgentFailure,
  isRetryableAgentFailure
} from '../agent'
import { TASK_IDS } from '../types'

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
          stdout: JSON.stringify({
            is_error: true,
            subtype: 'error_max_turns',
            num_turns: 51
          })
        },
        limits
      )
    ).toBe('reached maximum number of turns (51)')
    expect(
      describeAgentFailure(
        {
          signal: null,
          status: 1,
          stdout: JSON.stringify({
            is_error: true,
            errors: ['provider unavailable']
          })
        },
        limits
      )
    ).toBe('returned an error: provider unavailable')
    expect(
      describeAgentFailure(
        {
          signal: null,
          status: 1,
          stdout: JSON.stringify({
            is_error: true,
            result: 'API Error: usage allocated quota exceeded'
          })
        },
        limits
      )
    ).toBe('returned an error: API Error: usage allocated quota exceeded')
  })

  it('retries only bounded or quota-related agent failures', () => {
    const processResult = (stdout: Record<string, unknown>, error?: string) => ({
      error: error ? { message: error } : undefined,
      signal: null,
      status: 1,
      stdout: JSON.stringify(stdout)
    })

    expect(isRetryableAgentFailure(processResult({}, 'spawnSync claude ETIMEDOUT'))).toBe(true)
    expect(isRetryableAgentFailure(processResult({ is_error: true, subtype: 'error_max_turns' }))).toBe(true)
    expect(isRetryableAgentFailure(processResult({ is_error: true, api_error_status: 429 }))).toBe(true)
    expect(
      isRetryableAgentFailure(
        processResult({
          is_error: true,
          terminal_reason: 'api_error',
          result: 'API Error: Request rejected (429) · usage allocated quota exceeded'
        })
      )
    ).toBe(true)
    expect(
      isRetryableAgentFailure(
        processResult({
          is_error: true,
          terminal_reason: 'api_error',
          result: 'API Error: unauthorized'
        })
      )
    ).toBe(false)
    expect(isRetryableAgentFailure(processResult({ is_error: true, errors: ['provider unavailable'] }))).toBe(false)
    expect(isRetryableAgentFailure({ signal: null, status: 1, stdout: 'not json' })).toBe(false)
  })
})

describe('test agent skill prompt', () => {
  const source = readFileSync(resolve('.agents/skills/cherry-regression-test/SKILL.md'), 'utf8')

  it('includes only common guidance and the assigned task section', () => {
    const prompt = buildTaskSkillInstructions(source, 'quick-assistant')

    expect(prompt).toContain('1. Call `get-run-context`')
    expect(prompt).toContain('8. For C-02')
    expect(prompt).toContain('22. Use `system-action`')
    expect(prompt).not.toContain('6. For M-02')
    expect(prompt).not.toContain('21. For N-01')
    expect(prompt.length).toBeLessThan(source.length / 2)
  })

  it('builds a bounded prompt for every task', () => {
    for (const task of TASK_IDS) {
      const prompt = buildTaskSkillInstructions(source, task)
      expect(prompt).toContain('## Keep execution bounded')
      expect(prompt).not.toContain('description: Run Cherry Studio critical-path')
    }
  })
})
