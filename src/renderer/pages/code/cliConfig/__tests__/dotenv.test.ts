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
})
