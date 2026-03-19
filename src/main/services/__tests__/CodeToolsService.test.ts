import { describe, expect, it } from 'vitest'

import { escapeBatchText } from '../CodeToolsService'

describe('CodeToolsService - escapeBatchText', () => {
  it('preserves normal text without special characters', () => {
    const input = 'hello world'
    const result = escapeBatchText(input)
    expect(result).toBe('hello world')
  })

  it('converts Unix newlines to spaces', () => {
    const input = 'hello\nworld'
    const result = escapeBatchText(input)
    expect(result).toBe('hello world')
  })

  it('converts Windows newlines to spaces', () => {
    const input = 'hello\r\nworld'
    const result = escapeBatchText(input)
    expect(result).toBe('hello world')
  })

  it('escapes percent signs to prevent variable expansion', () => {
    const input = '100% complete'
    const result = escapeBatchText(input)
    expect(result).toBe('100%% complete')
  })

  it('handles multiple percent signs', () => {
    const input = 'user%username%path'
    const result = escapeBatchText(input)
    expect(result).toBe('user%%username%%path')
  })

  it('handles mixed newlines and percent signs', () => {
    const input = 'Resolving\ndependencies\n100% done'
    const result = escapeBatchText(input)
    expect(result).toBe('Resolving dependencies 100%% done')
  })

  it('returns empty string for empty input', () => {
    const input = ''
    const result = escapeBatchText(input)
    expect(result).toBe('')
  })

  it('handles npm error message with newlines', () => {
    const input = 'npm error code ECONNREFUSED\nResolving dependencies'
    const result = escapeBatchText(input)
    expect(result).toBe('npm error code ECONNREFUSED Resolving dependencies')
  })

  it('handles multiline error with percent in message', () => {
    const input = 'Error: 100% failed\nCheck %APPDATA%'
    const result = escapeBatchText(input)
    expect(result).toBe('Error: 100%% failed Check %%APPDATA%%')
  })
})
