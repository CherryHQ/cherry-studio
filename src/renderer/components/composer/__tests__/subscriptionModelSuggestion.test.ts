import { describe, expect, it } from 'vitest'

import type { CherryMessagePart, CherryUIMessage } from '@shared/data/types/message'
import type { ErrorPartData } from '@shared/data/types/uiParts'

import { shouldSuggestSubscriptionModel } from '../subscriptionModelSuggestion'

const user: CherryUIMessage = { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'hi' }], metadata: {} }

function failedReply(
  error: ErrorPartData,
  { modelId = 'openai::gpt-4o', status = 'error' as const, id = 'a1' } = {}
): CherryUIMessage {
  return {
    id,
    role: 'assistant',
    parts: [
      { type: 'text', text: 'partial' },
      { type: 'data-error', data: error }
    ],
    metadata: { parentId: 'u1', modelId, status }
  }
}

describe('shouldSuggestSubscriptionModel', () => {
  it.each([
    ['auth', { name: 'APICallError', message: 'Incorrect API key provided', statusCode: 401 }],
    ['permission', { name: 'APICallError', message: 'Forbidden', statusCode: 403 }],
    ['model', { name: 'APICallError', message: 'The model does not exist', statusCode: 404 }],
    ['rate_limit', { name: 'APICallError', message: 'Too many requests', statusCode: 429 }],
    ['server', { name: 'APICallError', message: 'Internal server error', statusCode: 500 }],
    ['local model resolution', { name: 'Error', message: 'Cannot resolve modelId: gpt-4o' }]
  ])('suggests a switch after a %s failure at another provider', (_case, error) => {
    expect(shouldSuggestSubscriptionModel([user, failedReply(error)])).toBe(true)
  })

  it('reads the provider from the frozen author snapshot before the row model id', () => {
    const reply = failedReply({ message: 'Unauthorized', statusCode: 401 }, { modelId: 'cherryai-subscription::m' })
    reply.metadata = {
      ...reply.metadata,
      messageSnapshot: { model: { id: 'gpt-4o', name: 'GPT-4o', provider: 'openai' } } as never
    }

    expect(shouldSuggestSubscriptionModel([user, reply])).toBe(true)
  })

  it('falls back to the provider recorded on the error itself', () => {
    const reply = failedReply({ message: 'Unauthorized', statusCode: 401, providerId: 'openai' })
    reply.metadata = { parentId: 'u1', status: 'error' }

    expect(shouldSuggestSubscriptionModel([user, reply])).toBe(true)
  })

  it('does not suggest switching away from a failing subscription model', () => {
    const reply = failedReply({ message: 'Unauthorized', statusCode: 401 }, { modelId: 'cherryai-subscription::m' })

    expect(shouldSuggestSubscriptionModel([user, reply])).toBe(false)
  })

  it.each([
    ['context_length', { message: "This model's maximum context length is 8192 tokens", statusCode: 400 }],
    ['network', { message: 'fetch failed' }]
  ])('ignores a %s failure another provider would repeat', (_case, error) => {
    expect(shouldSuggestSubscriptionModel([user, failedReply(error)])).toBe(false)
  })

  it('ignores a reply that did not end in an error', () => {
    const reply = failedReply({ message: 'Unauthorized', statusCode: 401 }, { status: 'paused' as never })

    expect(shouldSuggestSubscriptionModel([user, reply])).toBe(false)
  })

  it('ignores an earlier failure once a newer message follows it', () => {
    const failure = failedReply({ message: 'Unauthorized', statusCode: 401 })
    const followUp: CherryUIMessage = { ...user, id: 'u2', metadata: { parentId: failure.id } }

    expect(shouldSuggestSubscriptionModel([user, failure, followUp])).toBe(false)
  })

  it('ignores an error status without an error part', () => {
    const reply: CherryUIMessage = { ...failedReply({}), parts: [{ type: 'text', text: 'partial' }] }

    expect(shouldSuggestSubscriptionModel([user, reply])).toBe(false)
  })

  it('reads the error from the live parts when they are ahead of the persisted row', () => {
    const reply: CherryUIMessage = { ...failedReply({}), parts: [] }
    const liveParts: CherryMessagePart[] = [{ type: 'data-error', data: { message: 'Unauthorized', statusCode: 401 } }]

    expect(shouldSuggestSubscriptionModel([user, reply])).toBe(false)
    expect(shouldSuggestSubscriptionModel([user, reply], { [reply.id]: liveParts })).toBe(true)
  })
})
