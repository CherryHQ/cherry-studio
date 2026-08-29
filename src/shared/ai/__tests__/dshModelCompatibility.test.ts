import { MODALITY } from '@cherrystudio/provider-registry'
import type { Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { describe, expect, it } from 'vitest'

import { isDshCompatibleModel, resolveDshApi } from '../dshModelCompatibility'

function makeProvider(overrides: Partial<Provider>): Provider {
  return {
    id: 'p',
    name: 'P',
    ...overrides
  } as Provider
}

function makeModel(overrides: Partial<Model>): Model {
  return {
    id: 'p::m',
    providerId: 'p',
    name: 'M',
    capabilities: [],
    contextWindow: 128_000,
    ...overrides
  } as Model
}

const azureProvider = makeProvider({
  defaultChatEndpoint: 'openai-chat-completions',
  endpointConfigs: { 'openai-chat-completions': { adapterFamily: 'azure' } }
})

const inputModalityCases: Array<[string, Model['inputModalities'], boolean]> = [
  ['accepts undeclared input modalities', undefined, true],
  ['accepts empty input modalities', [], true],
  ['accepts text input', [MODALITY.TEXT], true],
  ['accepts text and image input', [MODALITY.TEXT, MODALITY.IMAGE], true],
  ['accepts text and audio input', [MODALITY.TEXT, MODALITY.AUDIO], true],
  ['accepts text and video input', [MODALITY.TEXT, MODALITY.VIDEO], true],
  ['rejects video-only input', [MODALITY.VIDEO], false],
  ['rejects image-only input', [MODALITY.IMAGE], false],
  ['rejects audio-only input', [MODALITY.AUDIO], false]
]

describe('isDshCompatibleModel', () => {
  it('accepts native wire families directly', () => {
    const provider = makeProvider({
      defaultChatEndpoint: 'anthropic-messages',
      endpointConfigs: { 'anthropic-messages': { adapterFamily: 'anthropic' } }
    })
    expect(resolveDshApi(provider, makeModel({}))).toBe('anthropic-messages')
    expect(isDshCompatibleModel(provider, makeModel({}))).toBe(true)
  })

  it('accepts gateway-routable models whose endpoint has no native dsh family', () => {
    expect(resolveDshApi(azureProvider, makeModel({}))).toBeUndefined()
    expect(isDshCompatibleModel(azureProvider, makeModel({}))).toBe(true)

    const vertexProvider = makeProvider({
      defaultChatEndpoint: 'google-generate-content',
      endpointConfigs: { 'google-generate-content': { adapterFamily: 'google-vertex' } }
    })
    expect(isDshCompatibleModel(vertexProvider, makeModel({}))).toBe(true)

    const loginProvider = makeProvider({
      authMethods: ['oauth'],
      defaultChatEndpoint: 'anthropic-messages',
      endpointConfigs: { 'anthropic-messages': { adapterFamily: 'anthropic' } }
    } as Partial<Provider>)
    expect(isDshCompatibleModel(loginProvider, makeModel({}))).toBe(true)
  })

  it('rejects models the gateway cannot route either', () => {
    // Non-chat endpoint: neither a dsh wire family nor gateway-routable.
    expect(isDshCompatibleModel(azureProvider, makeModel({ endpointTypes: ['openai-embeddings'] }))).toBe(false)
    // Provider ids containing ':' cannot round-trip the gateway's model address.
    expect(
      isDshCompatibleModel(
        makeProvider({
          id: 'corp:west',
          defaultChatEndpoint: 'openai-chat-completions',
          endpointConfigs: { 'openai-chat-completions': { adapterFamily: 'azure' } }
        }),
        makeModel({ providerId: 'corp:west' })
      )
    ).toBe(false)
  })

  it('does not require a declared context window', () => {
    expect(isDshCompatibleModel(azureProvider, makeModel({ contextWindow: undefined }))).toBe(true)
  })

  it.each(inputModalityCases)('%s', (_name, inputModalities, expected) => {
    expect(isDshCompatibleModel(azureProvider, makeModel({ inputModalities }))).toBe(expected)
  })
})
