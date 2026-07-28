import { describe, expect, it, vi } from 'vitest'

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn()
    })
  }
}))

const { sanitizeChannelOutput } = await import('../OutputSanitizer')

describe('sanitizeChannelOutput', () => {
  it('passes clean text unchanged', () => {
    const { text, redacted } = sanitizeChannelOutput('Hello, how can I help you today?')
    expect(text).toBe('Hello, how can I help you today?')
    expect(redacted).toBe(false)
  })

  it('redacts PEM private keys', () => {
    const input = `Here is the key:
-----BEGIN RSA PRIVATE KEY-----
MIIEpAIBAAKCAQEA0Z3VS5JJcds3xfn/ygWyF8H...
-----END RSA PRIVATE KEY-----
Done.`
    const { text, redacted } = sanitizeChannelOutput(input)
    expect(text).toContain('[REDACTED]')
    expect(text).not.toContain('MIIEpAIBAAKCAQEA')
    expect(redacted).toBe(true)
  })

  it('redacts AWS access key IDs', () => {
    const input = 'Your key is AKIAIOSFODNN7EXAMPLE'
    const { text, redacted } = sanitizeChannelOutput(input)
    expect(text).toContain('[REDACTED]')
    expect(text).not.toContain('AKIAIOSFODNN7EXAMPLE')
    expect(redacted).toBe(true)
  })

  it('redacts GitHub personal access tokens', () => {
    const input = 'Token: ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'
    const { text, redacted } = sanitizeChannelOutput(input)
    expect(text).toContain('[REDACTED]')
    expect(text).not.toContain('ghp_')
    expect(redacted).toBe(true)
  })

  it('redacts Anthropic API keys', () => {
    const input = 'api key: sk-ant-api03-xxxxxxxxxxxxxxxxxxxx'
    const { text, redacted } = sanitizeChannelOutput(input)
    expect(text).toContain('[REDACTED]')
    expect(text).not.toContain('sk-ant-')
    expect(redacted).toBe(true)
  })

  it('redacts OpenAI API keys', () => {
    const input = 'openai key is sk-proj-abcdefghijklmnopqrstuvwxyz'
    const { text, redacted } = sanitizeChannelOutput(input)
    expect(text).toContain('[REDACTED]')
    expect(redacted).toBe(true)
  })

  it('redacts Bearer tokens', () => {
    const input = 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.abc '
    const { text, redacted } = sanitizeChannelOutput(input)
    expect(text).toContain('[REDACTED]')
    expect(text).not.toContain('eyJhbGciOiJ')
    expect(redacted).toBe(true)
  })

  it('redacts key=value secrets', () => {
    const input = 'api_key=super_secret_key_12345678901234567890'
    const { text, redacted } = sanitizeChannelOutput(input)
    expect(text).toContain('[REDACTED]')
    expect(redacted).toBe(true)
  })

  it('does not redact short values that are not secrets', () => {
    const input = 'The password is "abc"'
    const { text, redacted } = sanitizeChannelOutput(input)
    // Too short to match key-value secret pattern (requires 16+ chars)
    expect(text).toBe('The password is "abc"')
    expect(redacted).toBe(false)
  })

  // --- Intended non-coverage (documents the false-positive tradeoff) ---
  // These cases are deliberately NOT redacted. The sanitizer favors precision
  // over recall: it only redacts AWS secret keys when preceded by the
  // `aws_secret_access_key` assignment, and only redacts key=value pairs whose
  // key is one of the allow-listed names. Locking this in prevents a future
  // change from broadening coverage into a high-false-positive regex.
  it('does not redact a bare 40-char value with no provider-prefixed key', () => {
    // A standalone 40-char base64 string is indistinguishable from non-secret
    // data; without the `aws_secret_access_key` prefix it is left untouched.
    const input = 'output: wJalrXUtnFEMIK7MDENGbPxRfiCYEXAMPLEKEY01'
    const { text, redacted } = sanitizeChannelOutput(input)
    expect(text).toBe(input)
    expect(redacted).toBe(false)
  })

  it('does not redact a key=value pair whose key is not in the allow-list', () => {
    // `database_url` is not one of the listed secret key names, so its value
    // passes through even though it exceeds the 16-char length threshold.
    const input = 'database_url=postgres://user:pass@host:5432/db'
    const { text, redacted } = sanitizeChannelOutput(input)
    expect(text).toBe(input)
    expect(redacted).toBe(false)
  })
})
