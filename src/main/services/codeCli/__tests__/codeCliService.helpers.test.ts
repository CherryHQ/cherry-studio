import { describe, expect, it } from 'vitest'

import { escapeBatchQuotedValue, escapeBatchUnquoted, isBatchQuotableEnvValue } from '../CodeCliService'
import { sanitizeEnvForLogging } from '../envRedaction'

describe('escapeBatchUnquoted', () => {
  it('preserves normal text without special characters', () => {
    const input = 'hello world'
    const result = escapeBatchUnquoted(input)
    expect(result).toBe('hello world')
  })

  it('converts Unix newlines to spaces', () => {
    const input = 'hello\nworld'
    const result = escapeBatchUnquoted(input)
    expect(result).toBe('hello world')
  })

  it('converts Windows newlines to spaces', () => {
    const input = 'hello\r\nworld'
    const result = escapeBatchUnquoted(input)
    expect(result).toBe('hello world')
  })

  it('escapes percent signs to prevent variable expansion', () => {
    const input = '100% complete'
    const result = escapeBatchUnquoted(input)
    expect(result).toBe('100%% complete')
  })

  it('handles multiple percent signs', () => {
    const input = 'user%username%path'
    const result = escapeBatchUnquoted(input)
    expect(result).toBe('user%%username%%path')
  })

  it('handles mixed newlines and percent signs', () => {
    const input = 'Resolving\ndependencies\n100% done'
    const result = escapeBatchUnquoted(input)
    expect(result).toBe('Resolving dependencies 100%% done')
  })

  it('returns empty string for empty input', () => {
    const input = ''
    const result = escapeBatchUnquoted(input)
    expect(result).toBe('')
  })

  it('handles null-like values', () => {
    // @ts-expect-error - testing edge cases
    expect(escapeBatchUnquoted(null)).toBe('')
    // @ts-expect-error - testing edge cases
    expect(escapeBatchUnquoted(undefined)).toBe('')
  })

  it('handles whitespace-only input', () => {
    expect(escapeBatchUnquoted('   ')).toBe('   ')
  })

  it('handles npm error message with newlines', () => {
    const input = 'npm error code ECONNREFUSED\nResolving dependencies'
    const result = escapeBatchUnquoted(input)
    expect(result).toBe('npm error code ECONNREFUSED Resolving dependencies')
  })

  it('handles multiline error with percent in message', () => {
    const input = 'Error: 100% failed\nCheck %APPDATA%'
    const result = escapeBatchUnquoted(input)
    expect(result).toBe('Error: 100%% failed Check %%APPDATA%%')
  })

  // Chinese characters tests
  it('preserves Chinese characters in paths', () => {
    const input = 'C:\\用户\\张三\\文档'
    const result = escapeBatchUnquoted(input)
    expect(result).toBe('C:\\用户\\张三\\文档')
  })

  it('handles Chinese text with newlines', () => {
    const input = '安装路径：C:\\用户\\张三\n版本号：1.0'
    const result = escapeBatchUnquoted(input)
    expect(result).toBe('安装路径：C:\\用户\\张三 版本号：1.0')
  })

  it('handles Chinese text with percent signs', () => {
    const input = '进度：50%'
    const result = escapeBatchUnquoted(input)
    expect(result).toBe('进度：50%%')
  })

  // Path with spaces tests
  it('preserves spaces in paths', () => {
    const input = 'C:\\Program Files\\App'
    const result = escapeBatchUnquoted(input)
    expect(result).toBe('C:\\Program Files\\App')
  })

  it('handles paths with spaces and percent signs', () => {
    const input = 'C:\\Program Files\\50% off'
    const result = escapeBatchUnquoted(input)
    expect(result).toBe('C:\\Program Files\\50%% off')
  })

  // Real-world npm/bun error scenarios
  it('handles multiline npm error messages', () => {
    const input = 'npm WARN deprecated\nnpm ERR! code ENOENT'
    const result = escapeBatchUnquoted(input)
    expect(result).toBe('npm WARN deprecated npm ERR! code ENOENT')
  })

  it('handles multiline bun error messages', () => {
    const input = 'bun error\nResolving...'
    const result = escapeBatchUnquoted(input)
    expect(result).toBe('bun error Resolving...')
  })

  it('handles realistic npm update warning message', () => {
    const input = 'npm warn deprecated\nResolving dependency'
    const result = escapeBatchUnquoted(input)
    expect(result).toBe('npm warn deprecated Resolving dependency')
  })

  // Consecutive newlines test - each newline becomes a space
  it('converts each newline to a space (not collapsing)', () => {
    const input = 'line1\n\n\nline2'
    const result = escapeBatchUnquoted(input)
    expect(result).toBe('line1   line2')
  })

  // Mixed complex scenario
  it('handles complex Chinese path with spaces and newlines', () => {
    const input = 'C:\\Users\\张三\\My Documents\nVersion: 50%'
    const result = escapeBatchUnquoted(input)
    expect(result).toBe('C:\\Users\\张三\\My Documents Version: 50%%')
  })

  // Cmd metacharacter escaping tests (Review Bot concerns)
  it('escapes pipe character', () => {
    const input = 'error | pipe'
    const result = escapeBatchUnquoted(input)
    expect(result).toBe('error ^| pipe')
  })

  it('escapes output redirect character', () => {
    const input = 'error > file'
    const result = escapeBatchUnquoted(input)
    expect(result).toBe('error ^> file')
  })

  it('escapes input redirect character', () => {
    const input = 'error < file'
    const result = escapeBatchUnquoted(input)
    expect(result).toBe('error ^< file')
  })

  it('escapes caret character', () => {
    const input = 'path^file'
    const result = escapeBatchUnquoted(input)
    expect(result).toBe('path^^file')
  })

  it('escapes command separator ampersand', () => {
    const input = 'cmd1 & cmd2'
    const result = escapeBatchUnquoted(input)
    expect(result).toBe('cmd1 ^& cmd2')
  })

  it('escapes multiple cmd metacharacters', () => {
    const input = 'error & | > <'
    const result = escapeBatchUnquoted(input)
    expect(result).toBe('error ^& ^| ^> ^<')
  })

  it('escapes real npm error with pipe character', () => {
    const input = 'npm ERR! command failed | npm ERR! path'
    const result = escapeBatchUnquoted(input)
    expect(result).toBe('npm ERR! command failed ^| npm ERR! path')
  })

  it('escapes bun error with redirect character', () => {
    const input = 'bun error > debug.log'
    const result = escapeBatchUnquoted(input)
    expect(result).toBe('bun error ^> debug.log')
  })
})

describe('escapeBatchQuotedValue', () => {
  it('doubles percent signs so the batch parser yields one', () => {
    expect(escapeBatchQuotedValue('C:\\Tools\\100% cli')).toBe('C:\\Tools\\100%% cli')
  })

  // Regression: cmd.exe does not process carets inside double quotes, so the
  // generic (unquoted) escaping left a literal `^` in the value and broke the
  // PATH segment it was meant to protect.
  it('leaves cmd metacharacters untouched — inside quotes they are already literal', () => {
    expect(escapeBatchQuotedValue('C:\\Dell & Co;C:\\a|b;C:\\c^d;C:\\e<f>g')).toBe(
      'C:\\Dell & Co;C:\\a|b;C:\\c^d;C:\\e<f>g'
    )
  })

  it('preserves spaces and non-ASCII path segments', () => {
    expect(escapeBatchQuotedValue('C:\\用户\\张三\\Program Files')).toBe('C:\\用户\\张三\\Program Files')
  })

  it('returns empty string for empty input', () => {
    expect(escapeBatchQuotedValue('')).toBe('')
  })
})

describe('isBatchQuotableEnvValue', () => {
  it('accepts values that cannot break out of the quoted set', () => {
    expect(isBatchQuotableEnvValue('C:\\Dell & Co;C:\\Windows')).toBe(true)
    expect(isBatchQuotableEnvValue('100% done')).toBe(true)
  })

  it('rejects values carrying a quote or a newline', () => {
    expect(isBatchQuotableEnvValue('a"b')).toBe(false)
    expect(isBatchQuotableEnvValue('a\nb')).toBe(false)
    expect(isBatchQuotableEnvValue('a\r\nb')).toBe(false)
  })
})

describe('sanitizeEnvForLogging - Sensitive Data Redaction', () => {
  it('should redact API_KEY values', () => {
    const env = { OPENAI_API_KEY: 'sk-secret123', MODEL: 'gpt-4' }
    const result = sanitizeEnvForLogging(env)
    expect(result.OPENAI_API_KEY).toBe('<redacted>')
    expect(result.MODEL).toBe('gpt-4')
  })

  it('should redact AUTHORIZATION tokens', () => {
    const env = { AUTHORIZATION: 'Bearer token123' }
    const result = sanitizeEnvForLogging(env)
    expect(result.AUTHORIZATION).toBe('<redacted>')
  })

  it('should redact TOKEN values', () => {
    const env = { GITHUB_TOKEN: 'ghp_12345' }
    const result = sanitizeEnvForLogging(env)
    expect(result.GITHUB_TOKEN).toBe('<redacted>')
  })

  it('should redact SECRET values', () => {
    const env = { AWS_SECRET_ACCESS_KEY: 'secret-key' }
    const result = sanitizeEnvForLogging(env)
    expect(result.AWS_SECRET_ACCESS_KEY).toBe('<redacted>')
  })

  it('should redact PASSWORD values', () => {
    const env = { DATABASE_PASSWORD: 'mypassword' }
    const result = sanitizeEnvForLogging(env)
    expect(result.DATABASE_PASSWORD).toBe('<redacted>')
  })

  it('should be case-insensitive for sensitive key detection', () => {
    const env = { api_key: 'lowercase', API_KEY: 'uppercase', Api_Key: 'mixed' }
    const result = sanitizeEnvForLogging(env)
    expect(result.api_key).toBe('<redacted>')
    expect(result.API_KEY).toBe('<redacted>')
    expect(result.Api_Key).toBe('<redacted>')
  })

  it('should handle empty environment object', () => {
    const env = {}
    const result = sanitizeEnvForLogging(env)
    expect(result).toEqual({})
  })

  it('should handle keys that partially contain sensitive words', () => {
    const env = { API_KEY_PATH: '/path/to/key', MODEL_PATH: '/path/to/model' }
    const result = sanitizeEnvForLogging(env)
    expect(result.API_KEY_PATH).toBe('<redacted>')
    expect(result.MODEL_PATH).toBe('/path/to/model')
  })
})
