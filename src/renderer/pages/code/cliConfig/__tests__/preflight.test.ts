import { describe, expect, it } from 'vitest'

import { ClaudeConfigPreflightError, cliConfigApplyErrorKey } from '../preflight'

describe('cliConfigApplyErrorKey', () => {
  it.each([
    ['route', 'code.claude_preflight.route_error'],
    ['authentication', 'code.claude_preflight.authentication_error'],
    ['model', 'code.claude_preflight.model_error'],
    ['service', 'code.claude_preflight.service_error']
  ] as const)('maps %s preflight failures to a specific user message', (category, expected) => {
    expect(cliConfigApplyErrorKey(new ClaudeConfigPreflightError(category, 404))).toBe(expected)
  })

  it('keeps unrelated config failures on the generic message', () => {
    expect(cliConfigApplyErrorKey(new Error('disk full'))).toBe('code.apply_failed')
  })
})
