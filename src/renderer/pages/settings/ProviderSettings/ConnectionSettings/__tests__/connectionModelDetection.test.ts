import { describe, expect, it } from 'vitest'

import { classifyEnabledApiKeyChange, parseEnabledApiKeyInput } from '../connectionModelDetection'

describe('connectionModelDetection', () => {
  it('normalizes comma-separated API key input', () => {
    expect(parseEnabledApiKeyInput(' sk-one, sk-two, sk-one ')).toEqual(['sk-one', 'sk-two', 'sk-one'])
  })

  it('requests detection when an enabled key is added, replaced, or enabled', () => {
    expect(classifyEnabledApiKeyChange([], ['sk-one'])).toBe('detect')
    expect(classifyEnabledApiKeyChange(['sk-one'], ['sk-two'])).toBe('detect')
    expect(classifyEnabledApiKeyChange(['sk-one'], ['sk-one', 'sk-two'])).toBe('detect')
  })

  it('only invalidates detection when enabled keys are removed or disabled', () => {
    expect(classifyEnabledApiKeyChange(['sk-one', 'sk-two'], ['sk-one'])).toBe('invalidate')
    expect(classifyEnabledApiKeyChange(['sk-one'], [])).toBe('invalidate')
  })

  it('ignores ordering and unchanged enabled key sets', () => {
    expect(classifyEnabledApiKeyChange(['sk-one', 'sk-two'], ['sk-two', 'sk-one'])).toBeNull()
    expect(classifyEnabledApiKeyChange(['sk-one'], [' sk-one '])).toBeNull()
  })
})
