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

describe('Qwen models use their platform brand', () => {
  it.each(['qwen-audio-3.1', 'qwen-image-2.1', 'qwen-mt-uni', 'qwen-image-3.0'])(
    'uses the blue mainland platform logo for %s',
    (modelId) => {
      expect(getModelLogoRef({ id: `dashscope::${modelId}`, name: modelId, providerId: 'dashscope' })).toEqual(
        expect.objectContaining({ kind: 'provider', key: 'dashscope' })
      )
    }
  )

  it('uses the purple international platform logo', () => {
    expect(
      getModelLogoRef({ id: 'qwencloud::qwen-image-3.0', name: 'Qwen Image 3.0', providerId: 'qwencloud' })
    ).toEqual(expect.objectContaining({ kind: 'provider', key: 'qwencloud' }))
  })

  it.each(['dashscope', 'qwencloud'])('keeps platform branding for a copy of %s', (presetProviderId) => {
    expect(
      getModelLogoRef(
        { id: 'my-provider::qwen-audio-3.1', name: 'Qwen Audio 3.1', providerId: 'my-provider' },
        { id: 'my-provider', presetProviderId }
      )
    ).toEqual(expect.objectContaining({ kind: 'provider', key: presetProviderId }))
  })

  it('recovers platform identity from a composite id when only the model is supplied', () => {
    expect(
      getModelLogoRef({ id: 'dashscope::custom-alias', apiModelId: 'Qwen/qwen-image-3.0', name: 'My image model' })
    ).toEqual(expect.objectContaining({ kind: 'provider', key: 'dashscope' }))
  })

  it('honors an explicit provider when selecting the platform brand', () => {
    expect(getModelLogoRef({ id: 'dashscope::qwen-image-3.0', name: 'Qwen Image 3.0' }, 'qwencloud')).toEqual(
      expect.objectContaining({ kind: 'provider', key: 'qwencloud' })
    )
  })

  it('preserves other model brands and Qwen models on unrelated providers', () => {
    expect(getModelLogoRef({ id: 'dashscope::deepseek-v4-pro', name: 'DeepSeek V4 Pro' })).toEqual(
      expect.objectContaining({ kind: 'model', key: 'deepseek' })
    )
    expect(getModelLogoRef({ id: 'openrouter::qwen/qwen3.8-max', name: 'Qwen 3.8 Max' })).toEqual(
      expect.objectContaining({ kind: 'model', key: 'qwen' })
    )
  })
})
