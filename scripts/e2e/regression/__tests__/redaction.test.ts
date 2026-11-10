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

  it('removes OAuth material discovered only in application logs', () => {
    const redact = createRedactor([])
    const output = redact(
      [
        'Authorization: Bearer dynamic-access-token',
        'callback cherrystudio://oauth/callback?code=dynamic-code&state=dynamic-state',
        "body: { key: 'dynamic-provider-key-1234567890', label: 'OAuth' }",
        'input: { "access_token": "dynamic-json-token", "key": "Escape" }'
      ].join('\n')
    )

    expect(output).not.toContain('dynamic-access-token')
    expect(output).not.toContain('dynamic-code')
    expect(output).not.toContain('dynamic-state')
    expect(output).not.toContain('dynamic-provider-key-1234567890')
    expect(output).not.toContain('dynamic-json-token')
    expect(output).toContain('"key": "Escape"')
  })
})
