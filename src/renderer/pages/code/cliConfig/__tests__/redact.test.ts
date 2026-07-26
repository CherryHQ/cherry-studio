import { parse as parseToml } from 'smol-toml'
import { describe, expect, it } from 'vitest'

import { redactSecretsInMessage } from '../redact'

/** Parse malformed TOML and return smol-toml's own thrown message (which embeds a raw source
 * codeblock), so redaction is tested against a real error shape rather than a hand-crafted string. */
function realTomlParseErrorMessage(malformedToml: string): string {
  try {
    parseToml(malformedToml)
    throw new Error('expected malformed TOML to throw')
  } catch (err) {
    return err instanceof Error ? err.message : String(err)
  }
}

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

  it('redacts a secret stranded after a broken/empty quoted value on a real smol-toml error', () => {
    // A missing separator splits the value into an empty quoted pair followed by the real secret as
    // a bare trailing token — smol-toml's own message embeds the raw source line verbatim.
    const message = realTomlParseErrorMessage('api_key = "" sk-ant-REALSECRET')
    expect(message).toContain('sk-ant-REALSECRET') // sanity: the real message does leak it pre-redaction
    expect(redactSecretsInMessage(message)).not.toContain('sk-ant-REALSECRET')
  })

  it('redacts a double-quoted secret containing an apostrophe on a real smol-toml error', () => {
    // smol-toml's codeblock includes the line before the actual error line too, so a perfectly valid
    // secret line can still end up embedded in the message when a later line is what fails to parse.
    // A naive ["'][^"']*["'] value match stops at the embedded apostrophe, leaking the tail (the part
    // of the secret after it) even though the quoted value read as a whole is fully redacted.
    const message = realTomlParseErrorMessage(`api_key = "sk-ant-don't-SECRET"\nbroken=====`)
    expect(message).toContain('SECRET') // sanity: the real message does leak it pre-redaction
    expect(redactSecretsInMessage(message)).not.toContain('SECRET')
  })
})
