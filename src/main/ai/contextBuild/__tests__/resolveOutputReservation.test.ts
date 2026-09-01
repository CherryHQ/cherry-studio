import { describe, expect, it, vi } from 'vitest'

import type { Assistant } from '@shared/data/types/assistant'
import { DEFAULT_ASSISTANT_SETTINGS } from '@shared/data/types/assistant'
import { ENDPOINT_TYPE, type Model } from '@shared/data/types/model'

const { mockGetAssistantById, mockGetProvider, mockResolveEndpoint } = vi.hoisted(() => ({
  mockGetAssistantById: vi.fn(),
  mockGetProvider: vi.fn(),
  mockResolveEndpoint: vi.fn()
}))

vi.mock('@data/services/AssistantService', () => ({ assistantDataService: { getById: mockGetAssistantById } }))
vi.mock('@main/data/services/ProviderService', () => ({ providerService: { getByProviderId: mockGetProvider } }))
vi.mock('../../provider/endpoint', () => ({ resolveEffectiveEndpoint: mockResolveEndpoint }))

const { resolveOutputReservation, resolveRequestedMaxOutputTokens } = await import('../resolveOutputReservation')

function makeModel(overrides: Partial<Model> = {}): Model {
  return { id: 'p::m', providerId: 'p', maxOutputTokens: 64_000, ...overrides } as Model
}

function makeAssistant(settings: Partial<Assistant['settings']>): Assistant {
  return { id: 'a1', settings: { ...DEFAULT_ASSISTANT_SETTINGS, ...settings } } as Assistant
}

describe('resolveRequestedMaxOutputTokens', () => {
  const model = makeModel()

  it('uses the model limit for Anthropic Messages when assistant max tokens are disabled', () => {
    const assistant = makeAssistant({ enableMaxTokens: false, maxTokens: 4_096 })

    expect(
      resolveRequestedMaxOutputTokens(undefined, undefined, assistant, model, ENDPOINT_TYPE.ANTHROPIC_MESSAGES)
    ).toBe(64_000)
  })

  it('uses an enabled assistant limit before the Anthropic model default', () => {
    const assistant = makeAssistant({ enableMaxTokens: true, maxTokens: 16_000 })

    expect(
      resolveRequestedMaxOutputTokens(undefined, undefined, assistant, model, ENDPOINT_TYPE.ANTHROPIC_MESSAGES)
    ).toBe(16_000)
  })

  it('uses a custom parameter before the assistant limit', () => {
    const assistant = makeAssistant({ enableMaxTokens: true, maxTokens: 16_000 })

    expect(resolveRequestedMaxOutputTokens(undefined, 24_000, assistant, model, ENDPOINT_TYPE.ANTHROPIC_MESSAGES)).toBe(
      24_000
    )
  })

  it('gives the per-request override highest precedence', () => {
    const assistant = makeAssistant({ enableMaxTokens: true, maxTokens: 16_000 })

    expect(resolveRequestedMaxOutputTokens(32_000, 24_000, assistant, model, ENDPOINT_TYPE.ANTHROPIC_MESSAGES)).toBe(
      32_000
    )
  })

  // The distinction the whole input-room calculation rests on: no max_tokens on
  // the wire means nothing is billed against the window, so nothing is reserved.
  it('does not use the model limit as an automatic cap for non-Anthropic endpoints', () => {
    expect(
      resolveRequestedMaxOutputTokens(undefined, undefined, undefined, model, ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS)
    ).toBeUndefined()
  })
})

describe('resolveOutputReservation', () => {
  const endpoint = (endpointType: string | undefined) => mockResolveEndpoint.mockReturnValue({ endpointType })

  it('reserves nothing when no model would send max_tokens', () => {
    endpoint(ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS)
    mockGetAssistantById.mockReturnValue(makeAssistant({ enableMaxTokens: false }))

    expect(resolveOutputReservation('a1', [makeModel()])).toBeUndefined()
  })

  // Window is taken as the MIN across compared models, so the reservation has to
  // be the MAX or the derived room would exceed what the smallest model allows.
  it('takes the largest reservation across compared models', () => {
    endpoint(ENDPOINT_TYPE.ANTHROPIC_MESSAGES)
    mockGetAssistantById.mockReturnValue(makeAssistant({ enableMaxTokens: false }))

    const reservation = resolveOutputReservation('a1', [
      makeModel({ maxOutputTokens: 8_000 }),
      makeModel({ maxOutputTokens: 64_000 })
    ])

    expect(reservation).toBe(64_000)
  })

  it('still reserves when only some of the compared models declare one', () => {
    mockGetAssistantById.mockReturnValue(makeAssistant({ enableMaxTokens: false }))
    mockResolveEndpoint
      .mockReturnValueOnce({ endpointType: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS })
      .mockReturnValueOnce({ endpointType: ENDPOINT_TYPE.ANTHROPIC_MESSAGES })

    expect(resolveOutputReservation('a1', [makeModel(), makeModel({ maxOutputTokens: 32_000 })])).toBe(32_000)
  })

  // A deleted assistant or an unreachable provider row must not fail the turn —
  // this runs on the durable compaction path, before the model stream opens.
  it('degrades to the assistant-less answer when the lookups throw', () => {
    endpoint(ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS)
    mockGetAssistantById.mockImplementation(() => {
      throw new Error('deleted')
    })
    mockGetProvider.mockImplementation(() => {
      throw new Error('no row')
    })

    expect(() => resolveOutputReservation('gone', [makeModel()])).not.toThrow()
    expect(resolveOutputReservation('gone', [makeModel()])).toBeUndefined()
  })
})
