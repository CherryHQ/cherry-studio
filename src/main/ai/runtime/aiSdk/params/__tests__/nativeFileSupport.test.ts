import { resolve } from 'node:path'

import { RegistryLoader } from '@cherrystudio/provider-registry/node'
import { mergePresetModel, synthesizePresetFromOverride } from '@data/services/ProviderRegistryService'
import { ENDPOINT_TYPE, type Model, MODEL_CAPABILITY } from '@shared/data/types/model'
import { describe, expect, it } from 'vitest'

import { makeModel } from '../../../../__tests__/fixtures/model'
import { makeProvider } from '../../../../__tests__/fixtures/provider'
import { resolveNativeFileSupport } from '../nativeFileSupport'

const registryDataDir = resolve('packages/provider-registry/data')
const registryLoader = new RegistryLoader({
  models: resolve(registryDataDir, 'models.json'),
  providers: resolve(registryDataDir, 'providers.json'),
  providerModels: resolve(registryDataDir, 'provider-models.json')
})

const cherryInUnsupportedAudioModelIds = [
  'qwen/qwen3.5-122b-a10b',
  'qwen/qwen3.5-27b',
  'qwen/qwen3.5-35b-a3b',
  'qwen/qwen3.5-35b-a3b(free)',
  'qwen/qwen3.5-397b-a17b',
  'qwen/qwen3.5-4b(free)',
  'qwen/qwen3.5-9b(free)'
] as const

function cherryInRegistryModel(apiModelId: string): Model {
  const override = registryLoader.findOverride('cherryin', apiModelId)
  if (!override) throw new Error(`Missing CherryIN override: ${apiModelId}`)
  const preset = registryLoader.findModel(override.modelId) ?? synthesizePresetFromOverride(override)
  return { ...mergePresetModel(preset, override, 'cherryin'), apiModelId }
}

describe('resolveNativeFileSupport', () => {
  it.each(cherryInUnsupportedAudioModelIds)('denies native audio for CherryIN %s', (apiModelId) => {
    const support = resolveNativeFileSupport(makeProvider({ id: 'cherryin' }), cherryInRegistryModel(apiModelId), {
      aiSdkProviderId: 'cherryin',
      runtimeProviderId: 'cherryin-chat',
      endpointType: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS
    })

    expect(support.audio).toBe(false)
  })

  it('keeps native audio for an audio-capable CherryIN model not covered by an override', () => {
    const support = resolveNativeFileSupport(
      makeProvider({ id: 'cherryin' }),
      makeModel({
        id: 'cherryin::qwen3-omni-flash',
        apiModelId: 'qwen3-omni-flash',
        name: 'qwen3-omni-flash',
        capabilities: [MODEL_CAPABILITY.AUDIO_RECOGNITION]
      }),
      {
        aiSdkProviderId: 'cherryin',
        runtimeProviderId: 'cherryin-chat',
        endpointType: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS
      }
    )

    expect(support.audio).toBe(true)
  })

  it('native PDF on an OpenAI Responses LLM model', () => {
    const ns = resolveNativeFileSupport(
      makeProvider({ id: 'openai' }),
      makeModel({ id: 'openai::gpt-4o', apiModelId: 'gpt-4o', name: 'gpt-4o' }),
      { aiSdkProviderId: 'openai', runtimeProviderId: 'openai' }
    )
    expect(ns.pdf).toBe(true)
    expect(typeof ns.image).toBe('boolean')
  })

  it('native PDF on an Anthropic model', () => {
    const ns = resolveNativeFileSupport(
      makeProvider({ id: 'anthropic' }),
      makeModel({ id: 'anthropic::claude', apiModelId: 'claude-3-5-sonnet-20241022', name: 'claude-3-5-sonnet' }),
      { aiSdkProviderId: 'anthropic', runtimeProviderId: 'anthropic' }
    )
    expect(ns.pdf).toBe(true)
  })

  it('no native PDF on an openai-compatible aggregator', () => {
    const ns = resolveNativeFileSupport(
      makeProvider({ id: 'somehub' }),
      makeModel({ id: 'somehub::gpt-4o', apiModelId: 'gpt-4o', name: 'gpt-4o' }),
      { aiSdkProviderId: 'openai-compatible', runtimeProviderId: 'openai-compatible' }
    )
    expect(ns.pdf).toBe(false)
    // audio/video gate on model capability — a plain gpt-4o is neither.
    expect(ns.audio).toBe(false)
    expect(ns.video).toBe(false)
  })

  it.each([
    ['openai', ENDPOINT_TYPE.OPENAI_RESPONSES, false, false],
    ['anthropic', ENDPOINT_TYPE.ANTHROPIC_MESSAGES, false, false],
    ['bedrock', ENDPOINT_TYPE.ANTHROPIC_MESSAGES, false, false],
    ['xai', ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS, false, false],
    ['mistral', ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS, false, false],
    ['groq', ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS, false, false],
    ['perplexity', ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS, false, false],
    ['openai-chat', ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS, true, false],
    ['openai-compatible', ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS, true, false],
    ['google', ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT, true, true],
    ['google-vertex', ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT, true, true],
    ['openrouter', ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS, true, true]
  ])('intersects model media capability with the $0 converter', (aiSdkProviderId, endpointType, audio, video) => {
    const model = makeModel({
      id: 'provider::multimodal',
      apiModelId: 'multimodal',
      name: 'multimodal',
      capabilities: [MODEL_CAPABILITY.AUDIO_RECOGNITION, MODEL_CAPABILITY.VIDEO_RECOGNITION]
    })
    const ns = resolveNativeFileSupport(makeProvider({ id: aiSdkProviderId }), model, {
      aiSdkProviderId,
      runtimeProviderId: aiSdkProviderId,
      endpointType
    })

    expect(ns.audio).toBe(audio)
    expect(ns.video).toBe(video)
  })

  it.each([ENDPOINT_TYPE.ANTHROPIC_MESSAGES, ENDPOINT_TYPE.OPENAI_RESPONSES])(
    'lets the resolved %s protocol deny override OpenRouter media support',
    (endpointType) => {
      const ns = resolveNativeFileSupport(
        makeProvider({ id: 'openrouter' }),
        makeModel({
          id: 'openrouter::multimodal',
          apiModelId: 'multimodal',
          name: 'multimodal',
          capabilities: [MODEL_CAPABILITY.AUDIO_RECOGNITION, MODEL_CAPABILITY.VIDEO_RECOGNITION]
        }),
        { aiSdkProviderId: 'openrouter', runtimeProviderId: 'openrouter', endpointType }
      )

      expect(ns.audio).toBe(false)
      expect(ns.video).toBe(false)
    }
  )

  it.each([
    [ENDPOINT_TYPE.ANTHROPIC_MESSAGES, false, false],
    [ENDPOINT_TYPE.OPENAI_RESPONSES, false, false],
    [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS, true, false],
    [ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT, true, true]
  ])('uses the resolved $0 endpoint for a multi-backend provider', (endpointType, audio, video) => {
    const ns = resolveNativeFileSupport(
      makeProvider({ id: 'aihubmix' }),
      makeModel({
        id: 'aihubmix::multimodal',
        apiModelId: 'multimodal',
        name: 'multimodal',
        capabilities: [MODEL_CAPABILITY.AUDIO_RECOGNITION, MODEL_CAPABILITY.VIDEO_RECOGNITION]
      }),
      { aiSdkProviderId: 'aihubmix', runtimeProviderId: 'aihubmix', endpointType }
    )

    expect(ns.audio).toBe(audio)
    expect(ns.video).toBe(video)
  })

  it('uses the actual runtime converter when it differs from the resolved adapter family', () => {
    const ns = resolveNativeFileSupport(
      makeProvider({ id: 'google-vertex' }),
      makeModel({
        id: 'google-vertex::partner-model',
        apiModelId: 'partner-model',
        name: 'partner-model',
        capabilities: [MODEL_CAPABILITY.AUDIO_RECOGNITION, MODEL_CAPABILITY.VIDEO_RECOGNITION]
      }),
      {
        aiSdkProviderId: 'google-vertex',
        runtimeProviderId: 'google-vertex-maas',
        endpointType: ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT
      }
    )

    expect(ns.audio).toBe(true)
    expect(ns.video).toBe(false)
  })

  it('forces text for providers known to break on native files (qiniu)', () => {
    const ns = resolveNativeFileSupport(
      makeProvider({ id: 'qiniu' }),
      makeModel({ id: 'qiniu::gpt-4o', apiModelId: 'gpt-4o', name: 'gpt-4o' }),
      { aiSdkProviderId: 'openai', runtimeProviderId: 'openai' }
    )
    expect(ns.pdf).toBe(false)
  })

  it('image rides on the vision model regardless of provider', () => {
    // isVisionModel is the gate; assert it's a boolean independent of the provider set.
    const ns = resolveNativeFileSupport(
      makeProvider({ id: 'somehub' }),
      makeModel({ id: 'somehub::gpt-4o', apiModelId: 'gpt-4o', name: 'gpt-4o' }),
      { aiSdkProviderId: 'openai-compatible', runtimeProviderId: 'openai-compatible' }
    )
    expect(typeof ns.image).toBe('boolean')
  })
})
