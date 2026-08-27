import { ENDPOINT_TYPE, type EndpointType } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { getModelPreferredEndpoint, isModelEndpointTypeAvailable } from '@shared/utils/provider'
import { describe, expect, it } from 'vitest'

type RoutingProvider = Parameters<typeof getModelPreferredEndpoint>[1]
type RoutingModel = Parameters<typeof getModelPreferredEndpoint>[0]

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

  it('keeps a runtime suggestion below a valid pin', () => {
    const model = makeModel(
      [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS, ENDPOINT_TYPE.OPENAI_RESPONSES],
      ENDPOINT_TYPE.OPENAI_RESPONSES
    )

    expect(getModelPreferredEndpoint(model, makeProvider(), ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS)).toBe(
      ENDPOINT_TYPE.OPENAI_RESPONSES
    )
  })

  it('uses a runtime suggestion once the pin is gone', () => {
    const model = makeModel([ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS, ENDPOINT_TYPE.OPENAI_RESPONSES])

    expect(getModelPreferredEndpoint(model, makeProvider(), ENDPOINT_TYPE.OPENAI_RESPONSES)).toBe(
      ENDPOINT_TYPE.OPENAI_RESPONSES
    )
  })
})

describe('isModelEndpointTypeAvailable', () => {
  it('does not infer an adapter from a shared host and a model declaration', () => {
    const provider = {
      id: 'some-aggregator',
      presetProviderId: 'some-aggregator',
      defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
      sharedEndpointHost: true,
      endpointConfigs: { [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl: 'https://open.example.net' } }
    } as RoutingProvider
    const model = makeModel([ENDPOINT_TYPE.ANTHROPIC_MESSAGES])

    expect(isModelEndpointTypeAvailable(model, provider, ENDPOINT_TYPE.ANTHROPIC_MESSAGES)).toBe(false)
  })

  it('accepts a declared shared-host route when its adapter is configured', () => {
    const provider = makeProvider({
      sharedEndpointHost: true,
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
})
