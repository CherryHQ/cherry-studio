import { CHERRYAI_DEFAULT_MODEL_ID, CHERRYAI_PROVIDER_ID } from '@shared/data/presets/cherryai'
import type { Model } from '@shared/data/types/model'
import { ENDPOINT_TYPE, MODEL_CAPABILITY } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { describe, expect, it } from 'vitest'

import { isAiSdkAgentCompatibleModel, isAiSdkAgentDrivableEndpoint } from '../aiSdkAgentCompatibility'

function makeProvider(overrides: Partial<Provider> = {}): Provider {
  return {
    id: 'p',
    name: 'P',
    defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
    ...overrides
  } as Provider
}

function makeModel(overrides: Partial<Model> = {}): Model {
  return {
    id: 'p::m',
    providerId: 'p',
    name: 'M',
    capabilities: [MODEL_CAPABILITY.FUNCTION_CALL],
    ...overrides
  } as Model
}

describe('isAiSdkAgentDrivableEndpoint', () => {
  it('accepts the chat protocol families and the undeclared-endpoint fallback', () => {
    expect(isAiSdkAgentDrivableEndpoint(undefined)).toBe(true)
    expect(isAiSdkAgentDrivableEndpoint(ENDPOINT_TYPE.ANTHROPIC_MESSAGES)).toBe(true)
    expect(isAiSdkAgentDrivableEndpoint(ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT)).toBe(true)
    expect(isAiSdkAgentDrivableEndpoint(ENDPOINT_TYPE.OLLAMA_CHAT)).toBe(true)
    expect(isAiSdkAgentDrivableEndpoint(ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS)).toBe(true)
    expect(isAiSdkAgentDrivableEndpoint(ENDPOINT_TYPE.OPENAI_RESPONSES)).toBe(true)
  })

  it('rejects non-chat endpoint families', () => {
    expect(isAiSdkAgentDrivableEndpoint(ENDPOINT_TYPE.JINA_RERANK)).toBe(false)
    expect(isAiSdkAgentDrivableEndpoint(ENDPOINT_TYPE.OPENAI_EMBEDDINGS)).toBe(false)
    expect(isAiSdkAgentDrivableEndpoint(ENDPOINT_TYPE.OPENAI_IMAGE_GENERATION)).toBe(false)
    expect(isAiSdkAgentDrivableEndpoint(ENDPOINT_TYPE.OPENAI_TEXT_COMPLETIONS)).toBe(false)
    expect(isAiSdkAgentDrivableEndpoint(ENDPOINT_TYPE.OLLAMA_GENERATE)).toBe(false)
  })
})

describe('isAiSdkAgentCompatibleModel', () => {
  it('accepts a function-calling model on a chat-endpoint provider', () => {
    expect(isAiSdkAgentCompatibleModel(makeProvider(), makeModel())).toBe(true)
  })

  it('fails closed for orphan models (no provider)', () => {
    expect(isAiSdkAgentCompatibleModel(undefined, makeModel())).toBe(false)
  })

  it('rejects external-CLI login providers', () => {
    const provider = makeProvider({ authMethods: ['external-cli'] })
    expect(isAiSdkAgentCompatibleModel(provider, makeModel())).toBe(false)
  })

  it('rejects the managed CherryAI free-quota default model', () => {
    const provider = makeProvider({ id: CHERRYAI_PROVIDER_ID })
    const model = makeModel({
      id: `${CHERRYAI_PROVIDER_ID}::${CHERRYAI_DEFAULT_MODEL_ID}`,
      providerId: CHERRYAI_PROVIDER_ID,
      apiModelId: CHERRYAI_DEFAULT_MODEL_ID
    })
    expect(isAiSdkAgentCompatibleModel(provider, model)).toBe(false)
  })

  it('rejects models without native function calling', () => {
    expect(isAiSdkAgentCompatibleModel(makeProvider(), makeModel({ capabilities: [] }))).toBe(false)
  })

  it('rejects a non-chat effective endpoint and honors the model-first endpoint priority', () => {
    const rerankProvider = makeProvider({ defaultChatEndpoint: ENDPOINT_TYPE.JINA_RERANK })
    expect(isAiSdkAgentCompatibleModel(rerankProvider, makeModel())).toBe(false)

    // The model's declared endpoint overrides the provider default (both directions).
    const chatModelOnRerankProvider = makeModel({ endpointTypes: [ENDPOINT_TYPE.ANTHROPIC_MESSAGES] })
    expect(isAiSdkAgentCompatibleModel(rerankProvider, chatModelOnRerankProvider)).toBe(true)
    const embeddingModelOnChatProvider = makeModel({ endpointTypes: [ENDPOINT_TYPE.OPENAI_EMBEDDINGS] })
    expect(isAiSdkAgentCompatibleModel(makeProvider(), embeddingModelOnChatProvider)).toBe(false)
  })

  it('treats a fully undeclared endpoint as the openai-compatible fallback', () => {
    const provider = makeProvider({ defaultChatEndpoint: undefined })
    expect(isAiSdkAgentCompatibleModel(provider, makeModel())).toBe(true)
  })
})
