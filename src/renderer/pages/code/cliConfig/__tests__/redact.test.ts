import { describe, expect, it } from 'vitest'

import { redactSecretsInMessage } from '../redact'

describe('redactSecretsInMessage', () => {
  it('redacts a quoted TOML-style api_key assignment', () => {
    expect(redactSecretsInMessage('unexpected character at line 3: api_key = "sk-ant-real-secret"')).toBe(
      'unexpected character at line 3: api_key = "<redacted>"'
    )
  })

  it('redacts a quoted JSON-style "apiKey" field', () => {
    expect(redactSecretsInMessage('invalid JSONC near "apiKey": "sk-ant-real-secret"')).toBe(
      'invalid JSONC near "apiKey": "<redacted>"'
    )
  })

  it('redacts a bare dotenv-style token value', () => {
    expect(redactSecretsInMessage('bad line: AUTH_TOKEN=sk-ant-real-secret')).toBe('bad line: AUTH_TOKEN="<redacted>"')
  })

  it('redacts secret and password variants', () => {
    expect(redactSecretsInMessage('client_secret = "abc123"')).toBe('client_secret = "<redacted>"')
    expect(redactSecretsInMessage('password: "hunter2"')).toBe('password: "<redacted>"')
  })

  it('leaves a message with no sensitive-looking keys unchanged', () => {
    const message = 'unexpected character at line 3, column 5: expected "," or "}"'
    expect(redactSecretsInMessage(message)).toBe(message)
  })

  it('fully redacts a multiline TOML triple-quoted secret', () => {
    const message = 'unexpected character: api_key = """\nsk-ant-real-secret\nmore-secret-lines\n"""'
    const result = redactSecretsInMessage(message)
    expect(result).not.toContain('sk-ant-real-secret')
    expect(result).not.toContain('more-secret-lines')
    expect(result).toBe('unexpected character: api_key = "<redacted>"')
  })

  it('redacts a Bearer token instead of only stripping the word "Bearer"', () => {
    const message = 'request failed: Authorization: Bearer sk-ant-real-secret'
    const result = redactSecretsInMessage(message)
    expect(result).not.toContain('sk-ant-real-secret')
  })
})
