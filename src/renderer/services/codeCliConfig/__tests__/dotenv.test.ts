import { parse as parseWithRealDotenv } from 'dotenv'
import { describe, expect, it } from 'vitest'

import { parseDotenv, renderDotenvFile } from '../dotenv'

describe('renderDotenvFile', () => {
  it('writes plain values without quotes', () => {
    expect(renderDotenvFile(new Map([['KEY', 'value']]))).toBe('KEY=value\n')
  })

  it('single-quotes a value containing # (single quotes are read back 100% literally)', () => {
    expect(renderDotenvFile(new Map([['HTTPS_PROXY', 'http://user:p#ss@host']]))).toBe(
      "HTTPS_PROXY='http://user:p#ss@host'\n"
    )
  })

  it('single-quotes a value with leading/trailing whitespace', () => {
    expect(renderDotenvFile(new Map([['KEY', ' value ']]))).toBe("KEY=' value '\n")
  })

  it('single-quotes a value containing a double quote instead of escaping it', () => {
    // The real `dotenv` package only re-expands `\n`/`\r` in double-quoted values on read — it never
    // unescapes `\"`, so a `\"`-escaped double-quoted value would come back with the backslash intact.
    expect(renderDotenvFile(new Map([['KEY', 'say "hi"']]))).toBe(`KEY='say "hi"'\n`)
  })

  it('single-quotes an empty value', () => {
    expect(renderDotenvFile(new Map([['KEY', '']]))).toBe("KEY=''\n")
  })

  it('falls back to double-quoting (unescaped) a value containing a single quote', () => {
    expect(renderDotenvFile(new Map([['KEY', "it's fine"]]))).toBe(`KEY="it's fine"\n`)
  })

  it('does not double a backslash in a Windows-style path value', () => {
    // Regression: escaping `\` to `\\` here corrupted the value on read-back, since the real
    // `dotenv` package never unescapes `\\` — it would come back with twice as many backslashes.
    expect(renderDotenvFile(new Map([['KEY', 'C:\\Users\\me']]))).toBe("KEY='C:\\Users\\me'\n")
  })
})

describe('renderDotenvFile output round-trips through the real dotenv package', () => {
  const cases = [
    'plain-value',
    'http://user:p#ss@host',
    ' leading-and-trailing ',
    'say "hi"',
    '',
    'C:\\Users\\me',
    'sk-proj-\\backslash\\and-hash#mixed'
  ]

  it.each(cases)('renders %j so the real dotenv package reads it back unchanged', (value) => {
    const rendered = renderDotenvFile(new Map([['KEY', value]]))
    expect(parseWithRealDotenv(rendered).KEY).toBe(value)
  })
})

describe('renderDotenvFile merge with the original content', () => {
  it('preserves comments, blank lines, and unparseable lines across a rewrite', () => {
    const original = '# gemini config\nUSER_KEY=keep\n\nnot env syntax at all\nGEMINI_API_KEY=old\n'
    const envMap = parseDotenv(original)
    envMap.set('GEMINI_API_KEY', 'new')

    expect(renderDotenvFile(envMap, original)).toBe(
      '# gemini config\nUSER_KEY=keep\n\nnot env syntax at all\nGEMINI_API_KEY=new\n'
    )
  })

  it('keeps unchanged entries byte-for-byte (quoting style and inline comment survive)', () => {
    const original = "export USER_KEY='keep' # mine\n"
    expect(renderDotenvFile(parseDotenv(original), original)).toBe(original)
  })

  it('drops every occurrence of a deleted key', () => {
    const original = 'GEMINI_API_KEY=a\n# note\nGEMINI_API_KEY=b\nUSER_KEY=keep\n'
    const envMap = parseDotenv(original)
    envMap.delete('GEMINI_API_KEY')

    expect(renderDotenvFile(envMap, original)).toBe('# note\nUSER_KEY=keep\n')
  })

  it('appends new keys after the preserved content', () => {
    const original = '# header\nUSER_KEY=keep\n'
    const envMap = parseDotenv(original)
    envMap.set('GEMINI_API_KEY', 'sk')

    expect(renderDotenvFile(envMap, original)).toBe('# header\nUSER_KEY=keep\nGEMINI_API_KEY=sk\n')
  })

  it('keeps an unchanged multi-line quoted value verbatim while replacing a neighbor', () => {
    const original = 'USER_PEM="a\nb\nc"\nGEMINI_API_KEY=old\n'
    const envMap = parseDotenv(original)
    envMap.set('GEMINI_API_KEY', 'new')

    expect(renderDotenvFile(envMap, original)).toBe('USER_PEM="a\nb\nc"\nGEMINI_API_KEY=new\n')
  })

  it('replaces a changed multi-line quoted value without disturbing its neighbors', () => {
    const original = '# pem\nUSER_PEM="a\nb\nc"\nAFTER=1\n'
    const envMap = parseDotenv(original)
    envMap.set('USER_PEM', 'flat')

    expect(renderDotenvFile(envMap, original)).toBe('# pem\nUSER_PEM=flat\nAFTER=1\n')
  })

  it('re-reads identically through the real dotenv package after a merge rewrite', () => {
    const original = '# note\nexport USER_KEY="with # hash"\nGEMINI_API_KEY=old # inline\n'
    const envMap = parseDotenv(original)
    envMap.set('GEMINI_API_KEY', 'new')
    const rewritten = renderDotenvFile(envMap, original)

    expect(parseWithRealDotenv(rewritten)).toEqual({ USER_KEY: 'with # hash', GEMINI_API_KEY: 'new' })
  })
})

describe('parseDotenv', () => {
  it('parses a plain unquoted value', () => {
    expect(parseDotenv('KEY=value\n')).toEqual(new Map([['KEY', 'value']]))
  })

  it('unquotes a double-quoted value without truncating at #', () => {
    expect(parseDotenv('HTTPS_PROXY="http://user:p#ss@host"\n')).toEqual(
      new Map([['HTTPS_PROXY', 'http://user:p#ss@host']])
    )
  })

  it('unquotes a single-quoted value', () => {
    expect(parseDotenv("KEY='value'\n")).toEqual(new Map([['KEY', 'value']]))
  })

  it('keeps `\\"` and `\\\\` escapes literal inside double quotes, matching the real dotenv package', () => {
    // Real dotenv only re-expands `\n`/`\r` in double-quoted values; it never unescapes `\"` or `\\`.
    // parseDotenv must match, or rewriting a hand-written `KEY="C:\\path"` would silently drop a backslash.
    const escapedQuote = 'KEY="say \\"hi\\""\n'
    expect(parseDotenv(escapedQuote).get('KEY')).toBe(parseWithRealDotenv(escapedQuote).KEY)
    const backslashPath = 'KEY="C:\\\\path"\n' // on disk: KEY="C:\\path"
    expect(parseDotenv(backslashPath).get('KEY')).toBe(parseWithRealDotenv(backslashPath).KEY)
    expect(parseDotenv(backslashPath).get('KEY')).toBe('C:\\\\path')
  })

  it('skips comment lines and blank lines', () => {
    expect(parseDotenv('# comment\n\nKEY=value\n')).toEqual(new Map([['KEY', 'value']]))
  })

  // Reviewer A1: the old hand-rolled parser read `export GEMINI_API_KEY=…` as the key
  // `export GEMINI_API_KEY`, so `clearCliConfig` (which deletes `GEMINI_API_KEY`) never scrubbed the
  // export-form secret. Parsing now matches the real dotenv loader, which strips the `export ` prefix.
  it.each([
    ['export GEMINI_API_KEY=secret\n', 'GEMINI_API_KEY', 'secret'],
    ['export GOOGLE_GEMINI_BASE_URL=https://x\n', 'GOOGLE_GEMINI_BASE_URL', 'https://x']
  ])('parses the `export ` prefix form %j to the bare key', (line, key, value) => {
    expect(parseDotenv(line)).toEqual(new Map([[key, value]]))
    expect(parseDotenv(line).get(key)).toBe(parseWithRealDotenv(line)[key])
  })

  it('strips an inline comment from an unquoted value, matching the real dotenv package', () => {
    const line = 'GEMINI_API_KEY=secret # my key\n'
    expect(parseDotenv(line).get('GEMINI_API_KEY')).toBe('secret')
    expect(parseDotenv(line).get('GEMINI_API_KEY')).toBe(parseWithRealDotenv(line).GEMINI_API_KEY)
  })

  it('preserves entry order while parsing (unlike the unordered dotenv object)', () => {
    expect([...parseDotenv('export B=2\nA=1\nexport C=3\n').keys()]).toEqual(['B', 'A', 'C'])
  })

  // End-to-end residue check: an export-form managed secret is now keyed correctly, so scrubbing the
  // managed keys and re-rendering leaves only the user's own entries — no leftover managed secret.
  it('lets export-form managed secrets be scrubbed on rewrite (no residue)', () => {
    const parsed = parseDotenv('export GEMINI_API_KEY=secret\nexport GOOGLE_GEMINI_BASE_URL=https://x\nUSER_KEY=keep\n')
    for (const managed of ['GEMINI_API_KEY', 'GOOGLE_GEMINI_BASE_URL']) parsed.delete(managed)
    expect(renderDotenvFile(parsed)).toBe('USER_KEY=keep\n')
  })
})

describe('round-trip', () => {
  const cases = ['plain-value', 'http://user:p#ss@host', ' leading-and-trailing ', 'say "hi"', '', "it's fine"]

  it.each(cases)('renders and re-parses %j unchanged', (value) => {
    const rendered = renderDotenvFile(new Map([['KEY', value]]))
    expect(parseDotenv(rendered).get('KEY')).toBe(value)
  })

  it('preserves a hand-written double-quoted backslash path across a parse→render rewrite', () => {
    // Reviewer scenario: a user hand-writes KEY="C:\\path"; Cherry parses the file then rewrites it.
    // The value the CLI tool (real dotenv) reads back must be identical before and after the rewrite.
    const handWritten = 'KEY="C:\\\\path"\n' // on disk: KEY="C:\\path"
    const original = parseWithRealDotenv(handWritten).KEY
    const rewritten = renderDotenvFile(parseDotenv(handWritten))
    expect(parseWithRealDotenv(rewritten).KEY).toBe(original)
  })

  // Re-review scenario: `clearCliConfig` blind-rewrites the whole .env. Parsing the whole content at
  // once (not line by line) reads a multi-line quoted value correctly, and quoting it on render keeps
  // it from being split across physical lines — so scrubbing a managed secret must not silently
  // corrupt an adjacent user multi-line value on disk.
  it('parses a multi-line quoted value spanning physical lines like the real loader', () => {
    const content = 'GEMINI_API_KEY=secret\nUSER_PEM="a\nb\nc"\nUSER_PLAIN=keep\n'
    expect(parseDotenv(content).get('USER_PEM')).toBe('a\nb\nc')
    expect(parseDotenv(content).get('USER_PEM')).toBe(parseWithRealDotenv(content).USER_PEM)
  })

  it('scrubs the managed key without corrupting a user multi-line value on rewrite', () => {
    const parsed = parseDotenv('GEMINI_API_KEY=secret\nUSER_PEM="a\nb\nc"\nUSER_PLAIN=keep\n')
    parsed.delete('GEMINI_API_KEY')
    const rewritten = renderDotenvFile(parsed)
    expect(parseWithRealDotenv(rewritten).GEMINI_API_KEY).toBeUndefined()
    expect(parseWithRealDotenv(rewritten).USER_PEM).toBe('a\nb\nc')
    expect(parseWithRealDotenv(rewritten).USER_PLAIN).toBe('keep')
  })
})
