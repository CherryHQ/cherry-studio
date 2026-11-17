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

  it.each([
    ['Authorization=Bearer xxx-proxy@!@#', { Authorization: 'Bearer xxx-proxy@!@#' }],
    ['Authorization=Bearer xxx-proxy@#!@', { Authorization: 'Bearer xxx-proxy@#!@' }],
    ['A=abc#', { A: 'abc#' }],
    ['A=a#b', { A: 'a#b' }],
    ['A=#secret', { A: '#secret' }],
    ['A=a # b', { A: 'a # b' }],
    ['A=a##b', { A: 'a##b' }],
    ['A=can\'t"`#x', { A: 'can\'t"`#x' }],
    ['A=a#  ', { A: 'a#' }],
    ['A=%23#%25', { A: '%23#%25' }],
    ['A="x" #tail', { A: '"x" #tail' }],
    ["A='x' #tail", { A: "'x' #tail" }],
    ['A=`x` #tail', { A: '`x` #tail' }]
  ])('preserves literal hashes in %j', (input, expected) => {
    expect(parseKeyValueString(input)).toEqual(expected)
  })

  it.each([
    ['A="a#b"', { A: 'a#b' }],
    ["A='a#b'", { A: 'a#b' }],
    ['A=`a#b`', { A: 'a#b' }],
    ['A=%23%25%ZZ%2523', { A: '%23%25%ZZ%2523' }],
    ['A=" value # "', { A: ' value # ' }],
    ['  KEY = value  ', { KEY: 'value' }],
    ['KEY=   ', { KEY: '' }],
    ['\n \n', {}],
    ['#COMMENT=x\n  # other=y\nB=2', { B: '2' }],
    ['A="first\n# middle=x\nlast"\nB=2', { A: 'first\n# middle=x\nlast', B: '2' }],
    ['A="first\r\n# middle=x\r\nlast"\r\nB=2', { A: 'first\n# middle=x\nlast', B: '2' }],
    ['A=one\r\nB=two\r\n', { A: 'one', B: 'two' }],
    ['A="x\\ny\\rz#"', { A: 'x\ny\rz#' }],
    ["A='x\\ny\\rz#'", { A: 'x\\ny\\rz#' }],
    ['A=`x\\ny\\rz#`', { A: 'x\\ny\\rz#' }],
    ['A: value', { A: 'value' }],
    ['export A=value', { A: 'value' }],
    ['=value\nB=2', { B: '2' }],
    ['BAD KEY=value\nB=2', { B: '2' }],
    ['BAD%KEY=value\nB=2', { B: '2' }],
    ['BAD#KEY=value\nB=2', { B: '2' }]
  ])('retains dotenv compatibility for %j', (input, expected) => {
    expect(parseKeyValueString(input)).toEqual(expected)
  })
})
