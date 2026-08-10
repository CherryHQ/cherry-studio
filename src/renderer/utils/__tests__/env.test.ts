import { describe, expect, it } from 'vitest'

import { parseKeyValueString } from '../env'

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
