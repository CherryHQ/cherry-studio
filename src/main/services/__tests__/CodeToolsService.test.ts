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

  it('handles null-like values', () => {
    // @ts-expect-error - testing edge cases
    expect(escapeBatchText(null)).toBe('')
    // @ts-expect-error - testing edge cases
    expect(escapeBatchText(undefined)).toBe('')
  })

  it('handles whitespace-only input', () => {
    expect(escapeBatchText('   ')).toBe('   ')
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

  // Chinese characters tests
  it('preserves Chinese characters in paths', () => {
    const input = 'C:\\用户\\张三\\文档'
    const result = escapeBatchText(input)
    expect(result).toBe('C:\\用户\\张三\\文档')
  })

  it('handles Chinese text with newlines', () => {
    const input = '安装路径：C:\\用户\\张三\n版本号：1.0'
    const result = escapeBatchText(input)
    expect(result).toBe('安装路径：C:\\用户\\张三 版本号：1.0')
  })

  it('handles Chinese text with percent signs', () => {
    const input = '进度：50%'
    const result = escapeBatchText(input)
    expect(result).toBe('进度：50%%')
  })

  // Path with spaces tests
  it('preserves spaces in paths', () => {
    const input = 'C:\\Program Files\\App'
    const result = escapeBatchText(input)
    expect(result).toBe('C:\\Program Files\\App')
  })

  it('handles paths with spaces and percent signs', () => {
    const input = 'C:\\Program Files\\50% off'
    const result = escapeBatchText(input)
    expect(result).toBe('C:\\Program Files\\50%% off')
  })

  // Real-world npm/bun error scenarios
  it('handles multiline npm error messages', () => {
    const input = 'npm WARN deprecated\nnpm ERR! code ENOENT'
    const result = escapeBatchText(input)
    expect(result).toBe('npm WARN deprecated npm ERR! code ENOENT')
  })

  it('handles multiline bun error messages', () => {
    const input = 'bun error\nResolving...'
    const result = escapeBatchText(input)
    expect(result).toBe('bun error Resolving...')
  })

  it('handles realistic npm update warning message', () => {
    const input = 'npm warn deprecated\nResolving dependency'
    const result = escapeBatchText(input)
    expect(result).toBe('npm warn deprecated Resolving dependency')
  })

  // Consecutive newlines test - each newline becomes a space
  it('converts each newline to a space (not collapsing)', () => {
    const input = 'line1\n\n\nline2'
    const result = escapeBatchText(input)
    expect(result).toBe('line1   line2')
  })

  // Mixed complex scenario
  it('handles complex Chinese path with spaces and newlines', () => {
    const input = 'C:\\Users\\张三\\My Documents\nVersion: 50%'
    const result = escapeBatchText(input)
    expect(result).toBe('C:\\Users\\张三\\My Documents Version: 50%%')
  })

  // Cmd metacharacter escaping tests (Review Bot concerns)
  it('escapes pipe character', () => {
    const input = 'error | pipe'
    const result = escapeBatchText(input)
    expect(result).toBe('error ^| pipe')
  })

  it('escapes output redirect character', () => {
    const input = 'error > file'
    const result = escapeBatchText(input)
    expect(result).toBe('error ^> file')
  })

  it('escapes input redirect character', () => {
    const input = 'error < file'
    const result = escapeBatchText(input)
    expect(result).toBe('error ^< file')
  })

  it('escapes caret character', () => {
    const input = 'path^file'
    const result = escapeBatchText(input)
    expect(result).toBe('path^^file')
  })

  it('escapes command separator ampersand', () => {
    const input = 'cmd1 & cmd2'
    const result = escapeBatchText(input)
    expect(result).toBe('cmd1 ^& cmd2')
  })

  it('escapes multiple cmd metacharacters', () => {
    const input = 'error & | > <'
    const result = escapeBatchText(input)
    expect(result).toBe('error ^& ^| ^> ^<')
  })

  it('escapes double quotes to prevent echo injection', () => {
    const input = 'npm error "ECONNREFUSED"'
    const result = escapeBatchText(input)
    expect(result).toBe('npm error ""ECONNREFUSED""')
  })

  it('escapes real npm error with pipe character', () => {
    const input = 'npm ERR! command failed | npm ERR! path'
    const result = escapeBatchText(input)
    expect(result).toBe('npm ERR! command failed ^| npm ERR! path')
  })

  it('escapes bun error with redirect character', () => {
    const input = 'bun error > debug.log'
    const result = escapeBatchText(input)
    expect(result).toBe('bun error ^> debug.log')
  })
})
