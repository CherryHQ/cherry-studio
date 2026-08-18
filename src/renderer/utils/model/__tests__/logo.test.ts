import { describe, expect, it } from 'vitest'

import { getModelLogoRef } from '../logo'

describe('getModelLogoRef — UniqueModelId + namespace normalization', () => {
  it('parses the "providerId::modelId" composite id (aihubmix::o3 → OpenAI)', () => {
    expect(getModelLogoRef({ id: 'aihubmix::o3', name: 'o3', providerId: 'aihubmix' })).toEqual(
      expect.objectContaining({ kind: 'provider', key: 'openai' })
    )
  })

  it('prefers apiModelId when present (aihubmix::whatever + apiModelId o3-mini → OpenAI)', () => {
    expect(
      getModelLogoRef({ id: 'aihubmix::x', apiModelId: 'o3-mini', name: 'o3 mini', providerId: 'aihubmix' })
    ).toEqual(expect.objectContaining({ kind: 'provider', key: 'openai' }))
  })

  it('strips both the "::" prefix and the "vendor/" namespace (openrouter lyria → Gemini)', () => {
    expect(
      getModelLogoRef({ id: 'openrouter::google/lyria-3-pro-preview', name: 'Lyria 3', providerId: 'openrouter' })
    ).toEqual(expect.objectContaining({ kind: 'model', key: 'gemini' }))
  })

  it('routes a TokenHub hy-* composite id to the Hunyuan icon', () => {
    expect(getModelLogoRef({ id: 'tokenhub::hy-role', name: 'Hunyuan Role', providerId: 'tokenhub' })).toEqual(
      expect.objectContaining({ kind: 'model', key: 'hunyuan' })
    )
  })

  it('base name wins over a misleading namespace token (gemini-router/kimi-k2 → Kimi)', () => {
    expect(getModelLogoRef({ id: 'aihub::gemini-router/kimi-k2', name: 'Kimi K2' })?.key).toBe('kimi')
  })
})
