/**
 * Unit tests for VENDOR_PATTERNS / matchVendor.
 * Patterns are anchored to the start of the (namespace-stripped) id, so a model resolves to at most
 * one vendor regardless of key insertion order.
 */
import { describe, expect, it } from 'vitest'

import { matchVendor } from '../patterns/vendor-patterns'

describe('matchVendor — anchored, order-independent (#5)', () => {
  it('resolves a cross-vendor id by its leading token, not insertion order', () => {
    expect(matchVendor('deepseek-grok')).toBe('deepseek')
    expect(matchVendor('kimi-grok')).toBe('kimi')
    expect(matchVendor('minimax-gemini')).toBe('minimax')
  })

  it('still resolves the straightforward vendor ids', () => {
    expect(matchVendor('claude-3-5-sonnet')).toBe('anthropic')
    expect(matchVendor('deepseek-r1')).toBe('deepseek')
    expect(matchVendor('grok-4')).toBe('grok')
    expect(matchVendor('mixtral-8x7b')).toBe('mistral')
  })
})

describe('matchVendor — hunyuan `hy-` is anchored (#6)', () => {
  it('matches the real hunyuan ids', () => {
    expect(matchVendor('hunyuan-t1')).toBe('hunyuan')
    expect(matchVendor('hy-role')).toBe('hunyuan')
  })

  it('matches the versioned `hyN` namespace (hy3-preview)', () => {
    expect(matchVendor('hy3-preview')).toBe('hunyuan')
  })

  it('no longer false-positives on a mid-string `hy`', () => {
    expect(matchVendor('why-model')).toBeUndefined()
    expect(matchVendor('hybrid-model')).toBeUndefined()
  })
})

describe('matchVendor — gemma covers the Ollama-style tags (#7)', () => {
  it('matches gemma-, gemmaN, and gemma: forms', () => {
    expect(matchVendor('gemma-7b')).toBe('gemma')
    expect(matchVendor('gemma2:9b')).toBe('gemma')
    expect(matchVendor('gemma3:27b')).toBe('gemma')
    expect(matchVendor('gemma:2b')).toBe('gemma')
  })
})

describe('matchVendor — lab/runtime parity for doubao + zhipu (#8, #9)', () => {
  it('doubao claims skylark', () => {
    expect(matchVendor('skylark-pro')).toBe('doubao')
  })

  it('zhipu claims codegeex and chatglm', () => {
    expect(matchVendor('codegeex-6b')).toBe('zhipu')
    expect(matchVendor('chatglm-6b')).toBe('zhipu')
    expect(matchVendor('glm-4-6')).toBe('zhipu')
  })
})
