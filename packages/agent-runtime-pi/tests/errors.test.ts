import {
  type AssistantMessage,
  InMemoryCredentialStore,
  isContextOverflow,
  normalizeContext
} from '@earendil-works/pi-ai'
import { ModelRuntime } from '@earendil-works/pi-coding-agent'
import { APICallError } from 'ai'
import { MockLanguageModelV3 } from 'ai/test'
import { describe, expect, it } from 'vitest'

import { createAiSdkProvider, type ModelCallInfo, type ModelCallPort } from '../src'
import { createTestSession, MODEL, streamTextPort } from './support'

const rateLimited = () =>
  new APICallError({
    message: 'Too Many Requests',
    url: 'https://api.example.com/v1/chat/completions',
    requestBodyValues: {},
    statusCode: 429,
    responseBody: '{"error":{"message":"rate limited"}}',
    isRetryable: true
  })

const failingModel = (error: unknown) =>
  new MockLanguageModelV3({
    doStream: async () => {
      throw error
    }
  })

describe('model call failures', () => {
  it.each([
    {
      source: 'an error part in the AI SDK stream',
      error: rateLimited(),
      port: (error: unknown) => streamTextPort(failingModel(error)).port
    },
    {
      source: 'a rejected port call',
      error: new Error('503 Service Unavailable'),
      port: (error: unknown): ModelCallPort => ({ streamText: async () => Promise.reject(error) })
    }
  ])('hands the original error from $source to the host and fails the turn once', async ({ error, port }) => {
    let portCalls = 0
    const inner = port(error)
    const failures: { error: unknown; call: ModelCallInfo }[] = []
    const { session } = await createTestSession({
      port: {
        streamText: (request) => {
          portCalls++
          return inner.streamText(request)
        }
      },
      sideChannel: { onError: (e, call) => failures.push({ error: e, call }) }
    })
    const events: string[] = []
    session.subscribe((event) => events.push(event.type))
    await session.prompt('hi').catch(() => {})

    expect(portCalls).toBe(1)
    expect(failures).toHaveLength(1)
    expect(failures[0].error).toBe(error)
    const assistants = session.messages.filter((m): m is AssistantMessage => m.role === 'assistant')
    expect(assistants).toHaveLength(1)
    expect(assistants[0]).toMatchObject({ stopReason: 'error', errorMessage: (error as Error).message })
    expect(events).not.toContain('auto_retry_start')
  })

  it('keeps the provider’s context-overflow text so Pi recognizes the overflow', async () => {
    const overflow = new APICallError({
      message: "This model's maximum context length is 8192 tokens. However, your messages resulted in 9000 tokens.",
      url: 'https://api.example.com/v1/chat/completions',
      requestBodyValues: {},
      statusCode: 400
    })
    const runtime = await ModelRuntime.create({
      credentials: new InMemoryCredentialStore(),
      modelsPath: null,
      refreshOnCreate: false
    })
    const { provider, ...spec } = MODEL
    runtime.registerProvider(
      provider,
      createAiSdkProvider({
        port: streamTextPort(failingModel(overflow)).port,
        requestOptions: undefined,
        models: [spec]
      })
    )
    const model = runtime.getModel(provider, spec.id)!
    const message = await runtime
      .streamSimple(model, normalizeContext({ messages: [{ role: 'user', content: 'hi', timestamp: 1 }] }))
      .result()

    expect(message.errorMessage).toBe(overflow.message)
    expect(isContextOverflow(message, model.contextWindow)).toBe(true)
  })
})
