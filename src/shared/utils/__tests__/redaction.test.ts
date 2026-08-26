import { parse as parseToml } from 'smol-toml'
import { describe, expect, it } from 'vitest'

import {
  isSensitiveKey,
  redactDeep,
  REDACTED,
  redactLiteral,
  redactRecord,
  redactSecretText,
  redactServerKey,
  redactUrlParams,
  redactUrlToOrigin
} from '../redaction'

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

describe('isSensitiveKey', () => {
  it('keeps every documented stem active (this list is the whole project key knowledge)', () => {
    for (const stem of ['key', 'token', 'secret', 'auth', 'credential', 'pass', 'cookie', 'session']) {
      expect(isSensitiveKey(`X_${stem.toUpperCase()}_VALUE`), `stem "${stem}"`).toBe(true)
    }
  })

  it('matches stems case-insensitively as substrings', () => {
    expect(isSensitiveKey('GITHUB_PERSONAL_ACCESS_TOKEN')).toBe(true)
    expect(isSensitiveKey('X-Api-Key')).toBe(true)
    expect(isSensitiveKey('dify_key')).toBe(true)
    expect(isSensitiveKey('Authorization')).toBe(true)
    expect(isSensitiveKey('DATABASE_PASSWORD')).toBe(true)
    expect(isSensitiveKey('MEMORY_FILE_PATH')).toBe(false)
    expect(isSensitiveKey('MODEL')).toBe(false)
  })

  it('matches exact names that no stem covers (httpTrace header regression)', () => {
    expect(isSensitiveKey('openai-organization')).toBe(true)
    expect(isSensitiveKey('OpenAI-Project')).toBe(true)
    expect(isSensitiveKey('openai-model')).toBe(false)
  })

  it('does NOT treat bare "code" as sensitive — it is query/text-scope only', () => {
    // Redacting every "code" key globally would mask source code in JSON bodies.
    expect(isSensitiveKey('code')).toBe(false)
  })
})

describe('redactRecord', () => {
  it('redacts sensitive keys, keeps benign values visible', () => {
    const out = redactRecord({
      OPENAI_API_KEY: 'sk-secret123',
      GITHUB_PERSONAL_ACCESS_TOKEN: 'github_pat_x',
      DIFY_KEY: 'app-secret',
      BASIC_AUTH: 'dXNlcjpwYXNz',
      MODEL: 'gpt-4',
      MEMORY_FILE_PATH: '/tmp/memory'
    })
    expect(out.OPENAI_API_KEY).toBe(REDACTED)
    expect(out.GITHUB_PERSONAL_ACCESS_TOKEN).toBe(REDACTED)
    expect(out.DIFY_KEY).toBe(REDACTED)
    expect(out.BASIC_AUTH).toBe(REDACTED)
    expect(out.MODEL).toBe('gpt-4')
    expect(out.MEMORY_FILE_PATH).toBe('/tmp/memory')
  })

  it('is case-insensitive', () => {
    const out = redactRecord({ api_key: 'a', Api_Key: 'b', 'X-Auth-Token': 'c' })
    expect(out.api_key).toBe(REDACTED)
    expect(out.Api_Key).toBe(REDACTED)
    expect(out['X-Auth-Token']).toBe(REDACTED)
  })
})

describe('redactDeep', () => {
  it('redacts sensitive keys at any depth, keeps benign ones', () => {
    const out = redactDeep({ authorization: 'Bearer x', keep: 'ok', nested: { apiKey: 'k' } }) as Record<string, any>
    expect(out.authorization).toBe(REDACTED)
    expect(out.keep).toBe('ok')
    expect(out.nested.apiKey).toBe(REDACTED)
  })

  it('truncates long strings past 300 chars', () => {
    const long = 'a'.repeat(400)
    const out = redactDeep({ data: long }) as Record<string, string>
    expect(out.data.startsWith('a'.repeat(300))).toBe(true)
    expect(out.data).toContain('<100 more>')
    expect(out.data).not.toContain('a'.repeat(301))
  })

  it('does not stack-overflow on a circular enumerable graph', () => {
    const a: Record<string, unknown> = { name: 'a' }
    const b: Record<string, unknown> = { name: 'b', a }
    a.b = b // a -> b -> a cycle
    expect(() => redactDeep(a)).not.toThrow()
    expect(redactDeep(a)).toMatchObject({ name: 'a', b: { name: 'b', a: '[Circular]' } })
  })

  it('leaves plain "code" keys intact (devtools body fidelity)', () => {
    const out = redactDeep({ code: 'print("hi")' }) as Record<string, string>
    expect(out.code).toBe('print("hi")')
  })
})

describe('redactServerKey (issue #18648)', () => {
  it('redacts env and headers values from a serialized server key', () => {
    const key = JSON.stringify({
      baseUrl: '',
      command: 'npx',
      args: ['@modelcontextprotocol/server-github'],
      env: { GITHUB_PERSONAL_ACCESS_TOKEN: 'github_pat_secret' },
      headers: { Authorization: 'Bearer secret' }
    })
    const out = redactServerKey(key)
    expect(out).not.toContain('github_pat_secret')
    expect(out).not.toContain('Bearer secret')
    expect(out).toContain(REDACTED)
    // non-sensitive fields stay visible for debugging
    expect(out).toContain('@modelcontextprotocol/server-github')
    expect(JSON.parse(out).env.GITHUB_PERSONAL_ACCESS_TOKEN).toBe(REDACTED)
  })

  it('fails closed: redacts credential-bearing values whose names match no sensitive pattern', () => {
    // Review regression (#18650): DATABASE_URL carries credentials in the VALUE —
    // key-name heuristics must not decide secrecy at this boundary.
    const key = JSON.stringify({
      command: 'npx',
      env: { DATABASE_URL: 'postgresql://user:password@host/db', DEBUG: '1' },
      headers: { 'X-Custom-Trace': 'secret-trace-value' }
    })
    const out = redactServerKey(key)
    expect(out).not.toContain('password')
    expect(out).not.toContain('secret-trace-value')
    const parsed = JSON.parse(out)
    expect(parsed.env.DATABASE_URL).toBe(REDACTED)
    expect(parsed.env.DEBUG).toBe(REDACTED)
    expect(parsed.headers['X-Custom-Trace']).toBe(REDACTED)
  })

  it('returns a placeholder for an unparseable server key', () => {
    expect(redactServerKey('not-json')).toBe('<unparseable-serverKey>')
  })

  it('leaves a key without env or headers untouched', () => {
    const key = JSON.stringify({ baseUrl: 'https://example.com', id: 'a1' })
    expect(redactServerKey(key)).toBe(key)
  })
})

describe('redactUrlToOrigin', () => {
  it('keeps only the origin for authenticated URLs with paths and query tokens', () => {
    expect(redactUrlToOrigin('http://user:pass@proxy.example:8080/path?token=secret#frag')).toBe(
      'http://proxy.example:8080'
    )
    expect(redactUrlToOrigin('https://api-key@server.example/mcp?access_token=secret')).toBe('https://server.example')
    expect(redactUrlToOrigin('socks5://user:pass@127.0.0.1:1080/path?token=secret')).toBe('socks5://127.0.0.1:1080')
  })

  it('redacts scheme-less proxy values to host and port only', () => {
    expect(redactUrlToOrigin('user:pass@proxy.example:8080/path?token=secret#frag')).toBe('proxy.example:8080')
    expect(redactUrlToOrigin('proxy.example:8080/path?token=secret')).toBe('proxy.example:8080')
  })

  it('falls back to a conservative marker for unparseable values', () => {
    expect(redactUrlToOrigin('not a url')).toBe('configured')
    expect(redactUrlToOrigin('http://')).toBe('configured')
    expect(redactUrlToOrigin('')).toBe('configured')
  })
})

describe('redactUrlParams', () => {
  it('redacts sensitive query values while keeping structure', () => {
    const out = redactUrlParams('https://api.example.com/v1?key=SECRET&model=test&token=SECRET2')
    expect(out).not.toContain('SECRET')
    expect(out).toContain('model=test')
    expect(new URL(out).searchParams.get('key')).toBe(REDACTED)
  })

  it('replaces userinfo credentials with the marker', () => {
    const out = redactUrlParams('https://user:pass@example.com/v1')
    expect(out).not.toContain('user')
    expect(out).not.toContain('pass')
    expect(out).toContain(encodeURIComponent(REDACTED))
  })

  it('redacts scope-limited extras like OAuth "code" only when passed', () => {
    const url = 'https://example.com/callback?code=OAUTH_SECRET&x=1'
    expect(redactUrlParams(url)).toContain('OAUTH_SECRET')
    expect(redactUrlParams(url, ['code'])).not.toContain('OAUTH_SECRET')
  })

  it('returns malformed input untouched', () => {
    expect(redactUrlParams('not a url')).toBe('not a url')
  })
})

// Regex design notes (kept here so the source stays under its inline-comment cap):
// - Triple-quoted alternatives must come before the bare-value fallback — otherwise a
//   multiline TOML secret is only redacted up to the first embedded newline.
// - The bare-value fallback intentionally consumes the rest of the line (not just one
//   token): a malformed source line can put the real secret past a broken/empty quoted
//   value (e.g. `api_key = "" sk-real-secret`), or inside a double-quoted value
//   containing an apostrophe — matching only a single quoted pair or token would leave
//   those trailing fragments unredacted.
// - Bearer/Basic is redacted before the key=value pass, which would otherwise consume
//   the literal word "Bearer" as the "value" for a preceding "Authorization:" key and
//   leave the real token intact.
// - Bearer/Basic tokens may be wrapped in literal quotes (OAuth error bodies echo the
//   header back as `Bearer "sk-..."`), so the quoted alternatives — including escaped
//   quotes inside — must match before the bare-token fallback, which excludes quotes.
describe('redactSecretText', () => {
  it('redacts a quoted TOML-style api_key assignment', () => {
    expect(redactSecretText('unexpected character at line 3: api_key = "sk-ant-real-secret"')).toBe(
      'unexpected character at line 3: api_key = "<redacted>"'
    )
  })

  it('redacts a quoted JSON-style "apiKey" field', () => {
    expect(redactSecretText('invalid JSONC near "apiKey": "sk-ant-real-secret"')).toBe(
      'invalid JSONC near "apiKey": "<redacted>"'
    )
  })

  it('redacts a bare dotenv-style token value', () => {
    expect(redactSecretText('bad line: AUTH_TOKEN=sk-ant-real-secret')).toBe('bad line: AUTH_TOKEN="<redacted>"')
  })

  it('redacts secret/password/credential variants', () => {
    expect(redactSecretText('client_secret = "abc123"')).toBe('client_secret = "<redacted>"')
    expect(redactSecretText('password: "hunter2"')).toBe('password: "<redacted>"')
    expect(redactSecretText('credentials = "abc"')).toBe('credentials = "<redacted>"')
  })

  it('leaves a message with no sensitive-looking keys unchanged', () => {
    const message = 'unexpected character at line 3, column 5: expected "," or "}"'
    expect(redactSecretText(message)).toBe(message)
  })

  it('does not redact benign English words containing stem letters', () => {
    const message = 'tests PASSED = 42, MONKEY = enabled'
    expect(redactSecretText(message)).toBe(message)
  })

  it('fully redacts a multiline TOML triple-quoted secret', () => {
    const message = 'unexpected character: api_key = """\nsk-ant-real-secret\nmore-secret-lines\n"""'
    const result = redactSecretText(message)
    expect(result).not.toContain('sk-ant-real-secret')
    expect(result).not.toContain('more-secret-lines')
    expect(result).toBe('unexpected character: api_key = "<redacted>"')
  })

  it('redacts Bearer and Basic scheme tokens instead of the scheme word alone', () => {
    expect(redactSecretText('request failed: Authorization: Bearer sk-ant-real-secret')).not.toContain(
      'sk-ant-real-secret'
    )
    expect(redactSecretText('proxy auth: Basic dXNlcjpwYXNz')).not.toContain('dXNlcjpwYXNz')
  })

  it('redacts quoted Bearer/Basic tokens, including escaped quotes inside', () => {
    // Regression (#18656 review): pre-consolidation call sites used Bearer\s+\S+, which
    // matched quoted tokens; the bare-token fallback alone excludes quotes and leaks them.
    expect(redactSecretText('detail: Bearer "sk-ant-quoted-secret"')).not.toContain('sk-ant-quoted-secret')
    expect(redactSecretText('detail: Bearer "sk-ant-quoted-secret"')).toBe('detail: Bearer <redacted>')
    expect(redactSecretText('err: Basic "dXNlcjpwYXNz"')).not.toContain('dXNlcjpwYXNz')
    expect(redactSecretText("err: Bearer 'sk-ant-single-quoted'")).not.toContain('sk-ant-single-quoted')
    expect(redactSecretText('Bearer "sk-with\\"escape"')).not.toContain('escape')
  })

  it('redacts scope-limited extras like OAuth "code=" only when passed', () => {
    const message = 'redirect: code=OAUTH_SECRET&x=1'
    expect(redactSecretText(message)).toContain('OAUTH_SECRET')
    expect(redactSecretText(message, ['code'])).not.toContain('OAUTH_SECRET')
  })

  it('escapes regex metacharacters in extraKeys instead of breaking the alternation', () => {
    const message = 'api_key = "sk-1"\nxtoken(v2) = "sk-2"'
    const result = redactSecretText(message, ['xtoken(v2)'])
    expect(result).toContain('api_key = "<redacted>"')
    expect(result).toContain('xtoken(v2) = "<redacted>"')
  })

  it('redacts a secret stranded after a broken/empty quoted value on a real smol-toml error', () => {
    // A missing separator splits the value into an empty quoted pair followed by the real secret as
    // a bare trailing token — smol-toml's own message embeds the raw source line verbatim.
    const message = realTomlParseErrorMessage('api_key = "" sk-ant-REALSECRET')
    expect(message).toContain('sk-ant-REALSECRET') // sanity: the real message does leak it pre-redaction
    expect(redactSecretText(message)).not.toContain('sk-ant-REALSECRET')
  })

  it('redacts a double-quoted secret containing an apostrophe on a real smol-toml error', () => {
    // smol-toml's codeblock includes the line before the actual error line too, so a perfectly valid
    // secret line can still end up embedded in the message when a later line is what fails to parse.
    // A naive ["'][^"']*["'] value match stops at the embedded apostrophe, leaking the tail (the part
    // of the secret after it) even though the quoted value read as a whole is fully redacted.
    const message = realTomlParseErrorMessage(`api_key = "sk-ant-don't-SECRET"\nbroken=====`)
    expect(message).toContain('SECRET') // sanity: the real message does leak it pre-redaction
    expect(redactSecretText(message)).not.toContain('SECRET')
  })
})

describe('redactLiteral', () => {
  it('replaces an exact runtime-known secret everywhere', () => {
    expect(redactLiteral('prefix sk-abc middle sk-abc end', 'sk-abc')).toBe(`prefix ${REDACTED} middle ${REDACTED} end`)
  })

  it('ignores an empty secret instead of destroying the text', () => {
    expect(redactLiteral('text', '')).toBe('text')
    expect(redactLiteral('text', undefined)).toBe('text')
  })
})
