import { createOpenAI } from '@ai-sdk/openai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { generateText, type ModelMessage, wrapLanguageModel } from 'ai'
import { createOllama } from 'ollama-ai-provider-v2'
import { expect, it } from 'vitest'

import type { AiRequestContext } from '@cherrystudio/ai-core'
import { ENDPOINT_TYPE, type EndpointType } from '@shared/data/types/model'

import type { RequestScope } from '../../scope'
import { conversationStateReplayFeature } from '../conversationStateReplay'

const origin = 'https://origin.invalid/v1'
const other = 'https://other.invalid/v1'

async function middleware(endpointType: EndpointType, providerId: string, modelId: string, baseURL: string) {
  const scope = {
    replayRouteId: baseURL,
    request: {},
    provider: { id: providerId },
    endpointType,
    sdkConfig: { providerId, providerOptionsKey: providerId, modelId, providerSettings: { baseURL } }
  } as RequestScope
  const context = { middlewares: [] } as unknown as AiRequestContext
  expect(conversationStateReplayFeature.applies?.(scope)).toBe(true)
  for (const plugin of conversationStateReplayFeature.contributeModelAdapters?.(scope) ?? []) {
    await plugin.configureContext?.(context)
  }
  return context.middlewares ?? []
}

it.each([false, true])('replays Responses state on the original route with store=%s', async (store) => {
  const modelId = 'gpt-5'
  const requests: unknown[] = []
  const modelAt = async (baseURL: string) =>
    wrapLanguageModel({
      model: createOpenAI({
        apiKey: 'test',
        baseURL,
        fetch: async (_url, init) => {
          requests.push(JSON.parse(String(init?.body)))
          return Response.json({
            id: 'resp_1',
            created_at: 0,
            model: modelId,
            status: 'completed',
            output: [
              { type: 'reasoning', id: 'rs_origin', summary: [], encrypted_content: 'opaque-state' },
              {
                type: 'message',
                id: 'msg_origin',
                role: 'assistant',
                status: 'completed',
                content: [{ type: 'output_text', text: 'Visible reply', annotations: [] }]
              }
            ],
            usage: { input_tokens: 1, output_tokens: 1 }
          })
        }
      }).responses(modelId),
      middleware: await middleware(ENDPOINT_TYPE.OPENAI_RESPONSES, 'openai', modelId, baseURL)
    })
  const providerOptions = { openai: { store } }
  const first = await generateText({ model: await modelAt(origin), prompt: 'First', providerOptions, maxRetries: 0 })
  const messages: ModelMessage[] = [
    { role: 'user', content: 'First' },
    ...first.response.messages,
    { role: 'user', content: 'Second' }
  ]
  for (const baseURL of [other, origin]) {
    await generateText({ model: await modelAt(baseURL), messages, providerOptions, maxRetries: 0 })
    const body = requests.at(-1)
    if (baseURL === origin) {
      expect(body).toMatchObject({
        input: expect.arrayContaining([
          store
            ? { type: 'item_reference', id: 'rs_origin' }
            : expect.objectContaining({ type: 'reasoning', encrypted_content: 'opaque-state' })
        ])
      })
    } else {
      expect(JSON.stringify(body)).toContain('Visible reply')
      expect(JSON.stringify(body)).not.toMatch(/opaque-state|item_reference|rs_origin|msg_origin/)
    }
  }
})

it.each([ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS, ENDPOINT_TYPE.OLLAMA_CHAT])(
  'removes prior plaintext thinking after a route change on %s',
  async (endpointType) => {
    const ollama = endpointType === ENDPOINT_TYPE.OLLAMA_CHAT
    const providerId = ollama ? 'ollama' : 'openai-compatible'
    const modelId = 'fixture-model'
    const requests: unknown[] = []
    const modelAt = async (baseURL: string) => {
      const fetch: typeof globalThis.fetch = async (_url, init) => {
        requests.push(JSON.parse(String(init?.body)))
        const message = { role: 'assistant', content: 'Visible reply' }
        return Response.json(
          ollama
            ? {
                model: modelId,
                created_at: '2026-11-26',
                done: true,
                done_reason: 'stop',
                message: { ...message, thinking: 'Private thinking' }
              }
            : {
                id: 'reply',
                created: 1,
                model: modelId,
                choices: [
                  { index: 0, message: { ...message, reasoning_content: 'Private thinking' }, finish_reason: 'stop' }
                ]
              }
        )
      }
      const model = ollama
        ? createOllama({ baseURL, fetch })(modelId)
        : createOpenAICompatible({ name: 'fixture', baseURL, fetch })(modelId)
      return wrapLanguageModel({ model, middleware: await middleware(endpointType, providerId, modelId, baseURL) })
    }
    const first = await generateText({ model: await modelAt(origin), prompt: 'First', maxRetries: 0 })
    const messages: ModelMessage[] = [
      { role: 'user', content: 'First' },
      ...first.response.messages,
      { role: 'user', content: 'Second' }
    ]
    for (const baseURL of [other, origin]) {
      await generateText({ model: await modelAt(baseURL), messages, maxRetries: 0 })
      const body = requests.at(-1)
      expect(JSON.stringify(body)).toContain('Visible reply')
      expect(JSON.stringify(body).includes('Private thinking')).toBe(baseURL === origin)
    }
  }
)
