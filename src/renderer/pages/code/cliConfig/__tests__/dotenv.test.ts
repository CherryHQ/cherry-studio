import { describe, expect, it } from 'vitest'

import { parseDotenv, renderDotenvFile } from '../dotenv'

describe('renderDotenvFile', () => {
  it('writes plain values without quotes', () => {
    expect(renderDotenvFile(new Map([['KEY', 'value']]))).toBe('KEY=value\n')
  })

  it('quotes a value containing #', () => {
    expect(renderDotenvFile(new Map([['HTTPS_PROXY', 'http://user:p#ss@host']]))).toBe(
      'HTTPS_PROXY="http://user:p#ss@host"\n'
    )
  })

  it('quotes a value with leading/trailing whitespace', () => {
    expect(renderDotenvFile(new Map([['KEY', ' value ']]))).toBe('KEY=" value "\n')
  })

  it('quotes and escapes a value containing a double quote', () => {
    expect(renderDotenvFile(new Map([['KEY', 'say "hi"']]))).toBe('KEY="say \\"hi\\""\n')
  })

  it('quotes an empty value', () => {
    expect(renderDotenvFile(new Map([['KEY', '']]))).toBe('KEY=""\n')
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

  it('unescapes a double-quoted value containing an escaped quote', () => {
    expect(parseDotenv('KEY="say \\"hi\\""\n')).toEqual(new Map([['KEY', 'say "hi"']]))
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
})
