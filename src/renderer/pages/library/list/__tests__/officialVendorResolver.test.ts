import type { Model } from '@shared/data/types/model'
import { describe, expect, it } from 'vitest'

import { resolveVendorModel, vendorOf } from '../officialVendorResolver'

function makeModel(overrides: Partial<Model> & Pick<Model, 'id' | 'providerId'>): Model {
  return {
    name: overrides.id,
    apiModelId: overrides.id.split('::')[1],
    capabilities: [],
    isEnabled: true,
    ...overrides
  } as Model
}

describe('vendorOf', () => {
  it('classifies direct providers by providerId', () => {
    expect(vendorOf(makeModel({ id: 'anthropic::claude-sonnet-4-6', providerId: 'anthropic' }))).toBe('anthropic')
    expect(vendorOf(makeModel({ id: 'openai::gpt-5', providerId: 'openai' }))).toBe('openai')
    expect(vendorOf(makeModel({ id: 'google::gemini-3-pro-preview', providerId: 'google' }))).toBe('google')
    expect(vendorOf(makeModel({ id: 'deepseek::deepseek-chat', providerId: 'deepseek' }))).toBe('deepseek')
    expect(vendorOf(makeModel({ id: 'moonshot::kimi-k2-5', providerId: 'moonshot' }))).toBe('moonshot')
    expect(vendorOf(makeModel({ id: 'doubao::doubao-seed-1-8', providerId: 'doubao' }))).toBe('doubao')
  })

  it('classifies provider aliases (gemini → google, volcengine → doubao)', () => {
    expect(vendorOf(makeModel({ id: 'gemini::gemini-2-5-pro', providerId: 'gemini' }))).toBe('google')
    expect(vendorOf(makeModel({ id: 'volcengine::doubao-seed-1-8', providerId: 'volcengine' }))).toBe('doubao')
  })

  it('classifies CherryIN models by modelId prefix', () => {
    expect(vendorOf(makeModel({ id: 'cherryin::claude-sonnet-4-6', providerId: 'cherryin' }))).toBe('anthropic')
    expect(vendorOf(makeModel({ id: 'cherryin::chatgpt-4o-latest', providerId: 'cherryin' }))).toBe('openai')
    expect(vendorOf(makeModel({ id: 'cherryin::gpt-5', providerId: 'cherryin' }))).toBe('openai')
    expect(vendorOf(makeModel({ id: 'cherryin::gemini-3-pro-preview', providerId: 'cherryin' }))).toBe('google')
    expect(vendorOf(makeModel({ id: 'cherryin::deepseek-chat', providerId: 'cherryin' }))).toBe('deepseek')
    expect(vendorOf(makeModel({ id: 'cherryin::kimi-k2-5', providerId: 'cherryin' }))).toBe('moonshot')
    expect(vendorOf(makeModel({ id: 'cherryin::doubao-seed-1-8', providerId: 'cherryin' }))).toBe('doubao')
  })

  it('returns null for non-vendor providers and unmatched CherryIN models', () => {
    expect(vendorOf(makeModel({ id: 'ollama::llama3', providerId: 'ollama' }))).toBeNull()
    expect(vendorOf(makeModel({ id: 'cherryin::some-random-model', providerId: 'cherryin' }))).toBeNull()
  })
})

describe('resolveVendorModel', () => {
  it('returns null when no enabled model exists for the vendor', () => {
    const models = [makeModel({ id: 'openai::gpt-5', providerId: 'openai' })]
    expect(resolveVendorModel('anthropic', { models })).toBeNull()
  })

  it('skips disabled models even if they match the vendor', () => {
    const models = [makeModel({ id: 'anthropic::claude-sonnet-4-6', providerId: 'anthropic', isEnabled: false })]
    expect(resolveVendorModel('anthropic', { models })).toBeNull()
  })

  it('honors user-set defaultModelId when it matches the vendor', () => {
    const models = [
      makeModel({ id: 'anthropic::claude-sonnet-4-6', providerId: 'anthropic' }),
      makeModel({ id: 'anthropic::claude-haiku-4-5', providerId: 'anthropic' })
    ]
    // Default is haiku (lower preference). Default wins anyway.
    expect(
      resolveVendorModel('anthropic', {
        models,
        defaultModelId: 'anthropic::claude-haiku-4-5'
      })
    ).toBe('anthropic::claude-haiku-4-5')
  })

  it('ignores defaultModelId when it belongs to a different vendor', () => {
    const models = [
      makeModel({ id: 'openai::gpt-5', providerId: 'openai' }),
      makeModel({ id: 'anthropic::claude-sonnet-4-6', providerId: 'anthropic' })
    ]
    expect(
      resolveVendorModel('anthropic', {
        models,
        defaultModelId: 'openai::gpt-5'
      })
    ).toBe('anthropic::claude-sonnet-4-6')
  })

  it('prefers CherryIN-hosted vendor model over direct provider when both have preferred model', () => {
    const models = [
      makeModel({ id: 'anthropic::claude-sonnet-4-6', providerId: 'anthropic' }),
      makeModel({ id: 'cherryin::claude-sonnet-4-6', providerId: 'cherryin' })
    ]
    expect(resolveVendorModel('anthropic', { models })).toBe('cherryin::claude-sonnet-4-6')
  })

  it('walks the preference list in order to find the closest official-default match', () => {
    const models = [
      // user has opus enabled but not sonnet — preference list has sonnet-4-6 first
      makeModel({ id: 'anthropic::claude-opus-4-6', providerId: 'anthropic' }),
      makeModel({ id: 'anthropic::claude-haiku-4-5', providerId: 'anthropic' })
    ]
    // Opus is preferred over haiku per VENDOR_MODEL_PREFERENCES order.
    expect(resolveVendorModel('anthropic', { models })).toBe('anthropic::claude-opus-4-6')
  })

  it('falls back to the first enabled vendor model when no preferred id matches', () => {
    const models = [
      makeModel({ id: 'anthropic::claude-old-model', providerId: 'anthropic' }),
      makeModel({ id: 'anthropic::claude-other-model', providerId: 'anthropic' })
    ]
    const resolved = resolveVendorModel('anthropic', { models })
    expect(resolved).toBe('anthropic::claude-old-model')
  })

  it('CherryIN bucket wins on fallback too', () => {
    const models = [
      makeModel({ id: 'anthropic::claude-unknown-1', providerId: 'anthropic' }),
      makeModel({ id: 'cherryin::claude-unknown-2', providerId: 'cherryin' })
    ]
    expect(resolveVendorModel('anthropic', { models })).toBe('cherryin::claude-unknown-2')
  })

  it('classifies CherryIN doubao models for doubao preset', () => {
    const models = [makeModel({ id: 'cherryin::doubao-seed-1-8', providerId: 'cherryin' })]
    expect(resolveVendorModel('doubao', { models })).toBe('cherryin::doubao-seed-1-8')
  })
})
