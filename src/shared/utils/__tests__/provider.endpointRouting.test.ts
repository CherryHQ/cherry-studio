import { ENDPOINT_TYPE, type EndpointType, MODEL_CAPABILITY } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import {
  getModelPreferredEndpoint as getModelPreferredEndpointForOperation,
  isModelEndpointTypeAvailable
} from '@shared/utils/provider'
import { describe, expect, it } from 'vitest'

type RoutingProvider = Parameters<typeof getModelPreferredEndpointForOperation>[1]
type RoutingModel = Parameters<typeof getModelPreferredEndpointForOperation>[0]

const getModelPreferredEndpoint = (model: RoutingModel, provider: RoutingProvider) =>
  getModelPreferredEndpointForOperation(model, provider, MODEL_CAPABILITY.TEXT_GENERATION)

function makeProvider(overrides: Partial<Provider> = {}): RoutingProvider {
  return {
    id: 'doubao',
    presetProviderId: 'doubao',
    defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
    endpointConfigs: {
      [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl: 'https://ark.example.com' },
      [ENDPOINT_TYPE.OPENAI_RESPONSES]: { baseUrl: 'https://ark.example.com' }
    },
    ...overrides
  } as RoutingProvider
}

function makeModel(endpointTypes?: EndpointType[], preferredEndpointType?: EndpointType): RoutingModel {
  return { id: 'doubao::seed', apiModelId: 'seed', endpointTypes, preferredEndpointType } as RoutingModel
}

describe('getModelPreferredEndpoint', () => {
  it('honors a pin the provider still serves', () => {
    const model = makeModel(
      [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS, ENDPOINT_TYPE.OPENAI_RESPONSES],
      ENDPOINT_TYPE.OPENAI_RESPONSES
    )

    expect(getModelPreferredEndpoint(model, makeProvider())).toBe(ENDPOINT_TYPE.OPENAI_RESPONSES)
  })

  it('skips a pin whose provider route was deleted rather than pairing its dialect with another host', () => {
    // The user pinned Responses, then removed that endpoint from the provider.
    const provider = makeProvider({
      endpointConfigs: { [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl: 'https://ark.example.com' } }
    })
    const model = makeModel(
      [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS, ENDPOINT_TYPE.OPENAI_RESPONSES],
      ENDPOINT_TYPE.OPENAI_RESPONSES
    )

    expect(getModelPreferredEndpoint(model, provider)).toBe(ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS)
  })

  it('screens every declared endpoint, not only the stale pin', () => {
    // Gemini is declared first but the provider serves no Google route. Filtering only the pin would
    // hand back Gemini and then resolve its base URL from the OpenAI host.
    const provider = makeProvider({
      endpointConfigs: { [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl: 'https://ark.example.com' } }
    })
    const model = makeModel([ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT, ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS])

    expect(getModelPreferredEndpoint(model, provider)).toBe(ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS)
  })

  it('keeps the declared protocol rather than borrowing the provider default when none is served', () => {
    // Answering with the provider default would hand a Google-only model the OpenAI host and call
    // it a success; callers must fail closed naming the protocol the model actually declares.
    const provider = makeProvider({
      defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
      endpointConfigs: { [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl: 'https://ark.example.com' } }
    })
    const model = makeModel([ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT])

    expect(getModelPreferredEndpoint(model, provider)).toBe(ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT)
  })

  it('uses the provider default only when the model declares nothing', () => {
    const provider = makeProvider({
      defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
      endpointConfigs: { [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl: 'https://ark.example.com' } }
    })

    expect(getModelPreferredEndpoint(makeModel(undefined), provider)).toBe(ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS)
  })

  it('uses the default chat endpoint instead of provider endpoint-config order for text', () => {
    const provider = makeProvider({
      defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
      endpointConfigs: {
        [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: { adapterFamily: 'anthropic' },
        [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl: 'https://open.example.net' }
      }
    })

    expect(getModelPreferredEndpoint(makeModel(undefined), provider)).toBe(ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS)
  })

  it('uses an explicitly configured provider operation route when the model does not constrain that operation', () => {
    const provider = makeProvider({
      endpointConfigs: {
        [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl: 'https://open.example.net' },
        [ENDPOINT_TYPE.OPENAI_EMBEDDINGS]: { adapterFamily: 'openai-compatible' }
      }
    })
    const model = makeModel([ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS])

    expect(getModelPreferredEndpointForOperation(model, provider, MODEL_CAPABILITY.EMBEDDING)).toBe(
      ENDPOINT_TYPE.OPENAI_EMBEDDINGS
    )
  })

  it('does not borrow a chat endpoint for an operation the provider did not configure', () => {
    expect(
      getModelPreferredEndpointForOperation(makeModel(undefined), makeProvider(), MODEL_CAPABILITY.EMBEDDING)
    ).toBeUndefined()
  })
})

describe('isModelEndpointTypeAvailable', () => {
  it('does not infer an adapter from a provider host and a model declaration', () => {
    const provider = {
      id: 'some-aggregator',
      presetProviderId: 'some-aggregator',
      defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
      endpointConfigs: { [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl: 'https://open.example.net' } }
    } as RoutingProvider
    const model = makeModel([ENDPOINT_TYPE.ANTHROPIC_MESSAGES])

    expect(isModelEndpointTypeAvailable(model, provider, ENDPOINT_TYPE.ANTHROPIC_MESSAGES)).toBe(false)
  })

  it('accepts a declared route when its adapter is configured', () => {
    const provider = makeProvider({
      endpointConfigs: {
        [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl: 'https://open.example.net' },
        [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: { adapterFamily: 'anthropic' }
      }
    })
    const model = makeModel([ENDPOINT_TYPE.ANTHROPIC_MESSAGES])

    expect(isModelEndpointTypeAvailable(model, provider, ENDPOINT_TYPE.ANTHROPIC_MESSAGES)).toBe(true)
    expect(isModelEndpointTypeAvailable(model, provider, ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT)).toBe(false)
  })

  it('still requires a configured route on an ordinary provider', () => {
    const model = makeModel([ENDPOINT_TYPE.ANTHROPIC_MESSAGES])

    expect(isModelEndpointTypeAvailable(model, makeProvider(), ENDPOINT_TYPE.ANTHROPIC_MESSAGES)).toBe(false)
  })

  it('accepts any configured route for a hand-added model that declares none', () => {
    const model = makeModel(undefined)

    expect(isModelEndpointTypeAvailable(model, makeProvider(), ENDPOINT_TYPE.OPENAI_RESPONSES)).toBe(true)
  })

  it('does not restore a gateway route excluded by an explicit model endpoint list', () => {
    const provider = makeProvider({
      id: 'aihubmix',
      presetProviderId: 'aihubmix',
      endpointConfigs: {
        [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl: 'https://aihubmix.example.com' },
        [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: { baseUrl: 'https://aihubmix.example.com' }
      }
    })
    const model: RoutingModel = {
      ...makeModel([ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS], ENDPOINT_TYPE.ANTHROPIC_MESSAGES),
      id: 'aihubmix::claude-opus-4-6',
      apiModelId: 'claude-opus-4-6'
    }

    expect(isModelEndpointTypeAvailable(model, provider, ENDPOINT_TYPE.ANTHROPIC_MESSAGES)).toBe(false)
    expect(getModelPreferredEndpoint(model, provider)).toBe(ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS)
  })
})
