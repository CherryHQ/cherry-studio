import { createRedactor } from '../redaction'

describe('sensitive output redaction', () => {
  it('removes configured secrets and authorization material from nested evidence', () => {
    const redact = createRedactor(['provider-secret', 'account-secret', 'automation@example.test'])
    const output = redact({
      headers: { Authorization: 'Bearer provider-secret', Cookie: 'session=account-secret' },
      nested: ['automation@example.test', 'safe'],
      text: 'key=provider-secret'
    })
    const serialized = JSON.stringify(output)

    expect(serialized).not.toContain('provider-secret')
    expect(serialized).not.toContain('account-secret')
    expect(serialized).not.toContain('automation@example.test')
    expect(output).toEqual({
      headers: { Authorization: '[REDACTED]', Cookie: '[REDACTED]' },
      nested: ['[REDACTED]', 'safe'],
      text: 'key=[REDACTED]'
    })
  })
})
