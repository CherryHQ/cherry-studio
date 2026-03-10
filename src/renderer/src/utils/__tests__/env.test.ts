import { describe, expect, it } from 'vitest'

import { parseKeyValueString, serializeKeyValueString } from '../env'

describe('parseKeyValueString', () => {
  it('should parse empty string', () => {
    expect(parseKeyValueString('')).toEqual({})
  })

  it('should parse single key-value pair', () => {
    expect(parseKeyValueString('KEY=value')).toEqual({ KEY: 'value' })
  })

  it('should parse multiple key-value pairs', () => {
    const input = `KEY1=value1
KEY2=value2
KEY3=value3`
    expect(parseKeyValueString(input)).toEqual({
      KEY1: 'value1',
      KEY2: 'value2',
      KEY3: 'value3'
    })
  })

  it('should handle quoted values', () => {
    expect(parseKeyValueString('KEY="quoted value"')).toEqual({ KEY: 'quoted value' })
  })

  it('should handle single quoted values', () => {
    expect(parseKeyValueString("KEY='single quoted'")).toEqual({ KEY: 'single quoted' })
  })

  it('should handle values with equals signs', () => {
    expect(parseKeyValueString('URL=https://example.com?param=value')).toEqual({
      URL: 'https://example.com?param=value'
    })
  })

  it('should handle empty values', () => {
    expect(parseKeyValueString('KEY=')).toEqual({ KEY: '' })
  })

  it('should handle comments', () => {
    const input = `KEY=value
# This is a comment
ANOTHER_KEY=another_value`
    expect(parseKeyValueString(input)).toEqual({
      KEY: 'value',
      ANOTHER_KEY: 'another_value'
    })
  })

  it('should handle whitespace around key-value pairs', () => {
    expect(parseKeyValueString('  KEY=value  \n  ANOTHER=another  ')).toEqual({
      KEY: 'value',
      ANOTHER: 'another'
    })
  })

  it('should handle special characters in values', () => {
    expect(parseKeyValueString('KEY=value with spaces & symbols!')).toEqual({
      KEY: 'value with spaces & symbols!'
    })
  })

  it('should handle multiline values', () => {
    const input = `KEY="value
with
multiple
lines"`
    expect(parseKeyValueString(input)).toEqual({
      KEY: 'value\nwith\nmultiple\nlines'
    })
  })

  it('should handle invalid lines gracefully', () => {
    const input = `KEY=value
invalid line without equals
ANOTHER_KEY=another_value`
    expect(parseKeyValueString(input)).toEqual({
      KEY: 'value',
      ANOTHER_KEY: 'another_value'
    })
  })

  it('should handle duplicate keys (last one wins)', () => {
    const input = `KEY=first
KEY=second
KEY=third`
    expect(parseKeyValueString(input)).toEqual({ KEY: 'third' })
  })

  it('should handle keys and values with special characters', () => {
    expect(parseKeyValueString('API-URL_123=https://api.example.com/v1/users')).toEqual({
      'API-URL_123': 'https://api.example.com/v1/users'
    })
  })
})

describe('serializeKeyValueString', () => {
  it('should serialize empty record', () => {
    expect(serializeKeyValueString({})).toBe('')
  })

  it('should serialize simple key-value pairs', () => {
    expect(serializeKeyValueString({ KEY: 'value', OTHER: 'test' })).toBe('KEY=value\nOTHER=test')
  })

  it('should single-quote values containing #', () => {
    const serialized = serializeKeyValueString({ TOKEN: 'abc#123' })
    expect(serialized).toBe("TOKEN='abc#123'")
  })

  it('should double-quote values containing newlines', () => {
    const serialized = serializeKeyValueString({ KEY: 'line1\nline2' })
    expect(serialized).toBe('KEY="line1\nline2"')
  })

  it('should single-quote values with leading/trailing whitespace', () => {
    const serialized = serializeKeyValueString({ KEY: ' spaced ' })
    expect(serialized).toBe("KEY=' spaced '")
  })

  it('should not quote values containing double quotes (dotenv handles them unquoted)', () => {
    const serialized = serializeKeyValueString({ KEY: 'say "hello"' })
    expect(serialized).toBe('KEY=say "hello"')
  })

  it('should not quote values containing backslashes', () => {
    const serialized = serializeKeyValueString({ KEY: 'c:\\temp\\file' })
    expect(serialized).toBe('KEY=c:\\temp\\file')
  })

  it('should use double quotes for # values containing single quotes', () => {
    const serialized = serializeKeyValueString({ KEY: "it's #here" })
    expect(serialized).toBe('KEY="it\'s #here"')
  })

  it('should round-trip with parseKeyValueString for values with #', () => {
    const original = { TOKEN: 'abc#123', SIMPLE: 'value' }
    const serialized = serializeKeyValueString(original)
    const parsed = parseKeyValueString(serialized)
    expect(parsed).toEqual(original)
  })

  it('should round-trip with parseKeyValueString for multiline values', () => {
    const original = { KEY: 'line1\nline2\nline3' }
    const serialized = serializeKeyValueString(original)
    const parsed = parseKeyValueString(serialized)
    expect(parsed).toEqual(original)
  })

  it('should round-trip with parseKeyValueString for values with double quotes', () => {
    const original = { KEY: 'say "hello"' }
    const serialized = serializeKeyValueString(original)
    const parsed = parseKeyValueString(serialized)
    expect(parsed).toEqual(original)
  })

  it('should round-trip with parseKeyValueString for values with backslashes', () => {
    const original = { KEY: 'c:\\temp\\file' }
    const serialized = serializeKeyValueString(original)
    const parsed = parseKeyValueString(serialized)
    expect(parsed).toEqual(original)
  })

  it('should round-trip with parseKeyValueString for backslash+hash values', () => {
    const original = { KEY: 'c:\\temp\\x#1' }
    const serialized = serializeKeyValueString(original)
    const parsed = parseKeyValueString(serialized)
    expect(parsed).toEqual(original)
  })
})
