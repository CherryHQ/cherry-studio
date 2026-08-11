import { describe, expect, it } from 'vitest'

import { sanitizeProviderName } from '../provider'

// The output is embedded in config-file provider keys (renderer) and the
// matching shell-assembled launch command (main), so the whitelist doubles as
// an injection guard — every case here pins that surface.
describe('sanitizeProviderName', () => {
  it('converts spaces to dashes', () => {
    expect(sanitizeProviderName('My Provider', 'p1')).toBe('My-Provider')
  })

  it('strips characters outside the env-var-safe whitelist', () => {
    expect(sanitizeProviderName('Provider/Name', 'p1')).toBe('ProviderName')
    expect(sanitizeProviderName('My Provider <test>:name', 'p1')).toBe('My-Provider-testname')
  })

  it('strips shell metacharacters that could reach the launch command', () => {
    expect(sanitizeProviderName('foo@bar+baz(test)', 'p1')).toBe('foobarbaztest')
    expect(sanitizeProviderName('my$provider!name', 'p1')).toBe('myprovidername')
    expect(sanitizeProviderName('a#b%c&d;e`f', 'p1')).toBe('abcdef')
    expect(sanitizeProviderName('pro\'vi"der', 'p1')).toBe('provider')
  })

  it('keeps allowed env-var-safe characters', () => {
    expect(sanitizeProviderName('my-provider', 'p1')).toBe('my-provider')
    expect(sanitizeProviderName('my_provider', 'p1')).toBe('my_provider')
    expect(sanitizeProviderName('my.provider', 'p1')).toBe('my.provider')
    expect(sanitizeProviderName('Provider123', 'p1')).toBe('Provider123')
  })

  it('drops non-ASCII while keeping the ASCII remainder', () => {
    expect(sanitizeProviderName('日本語Provider', 'p1')).toBe('Provider')
    expect(sanitizeProviderName('My 测试 Provider', 'p1')).toBe('My-Provider')
    expect(sanitizeProviderName('🎉provider', 'p1')).toBe('provider')
  })

  it('falls back to the caller-supplied id when nothing survives sanitization', () => {
    expect(sanitizeProviderName('', 'p1')).toBe('p1')
    expect(sanitizeProviderName('测试', 'provider-id')).toBe('provider-id')
    expect(sanitizeProviderName('プロバイダー', 'p1')).toBe('p1')
  })
})
