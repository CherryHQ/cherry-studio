import { createOpenAI } from '@ai-sdk/openai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { generateText, type ModelMessage, readUIMessageStream, streamText, wrapLanguageModel } from 'ai'
import { createOllama } from 'ollama-ai-provider-v2'
import { expect, it } from 'vitest'

import type { AiRequestContext } from '@cherrystudio/ai-core'
import type { CherryUIMessage } from '@shared/data/types/message'
import { ENDPOINT_TYPE, type EndpointType } from '@shared/data/types/model'

import { makeModel } from '../../../../../__tests__/fixtures'
import { toModelMessages } from '../../../../../messages/messageRules'
import { dropEmptyContentParts } from '../../../../../streamManager/persistence/PersistenceBackend'
import { withReasoningTimingMetadata } from '../../../../../streamManager/withReasoningTimingMetadata'
import type { RequestScope } from '../../scope'
import { conversationStateReplayFeature } from '../conversationStateReplay'

const origin = 'https://origin.invalid/v1'
const other = 'https://other.invalid/v1'

async function middleware(endpointType: EndpointType, providerId: string, modelId: string, baseURL: string) {
  const scope = {
    replayRouteId: baseURL,
    request: {},
    provider: { id: providerId },
    model: makeModel({ apiModelId: modelId }),
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

it.each(['generate', 'deltas', 'snapshot', 'ciphertext-only'] as const)(
  'replays Responses reasoning from %s only on its source route',
  async (mode) => {
    const modelId = 'fixture-model'
    const content =
      mode === 'ciphertext-only' ? [] : [{ type: 'reasoning_text', text: 'First thought. Second thought.' }]
    const reasoning = {
      id: mode === 'deltas' ? 'origin-reasoning' : 'rs_origin',
      type: 'reasoning',
      summary: [],
      content,
      encrypted_content: 'opaque-state'
    }
    const message = {
      id: 'msg_origin',
      type: 'message',
      role: 'assistant',
      status: 'completed',
      content: [{ type: 'output_text', text: 'Visible reply', annotations: [] }]
    }
    const reply = {
      id: 'resp_1',
      created_at: 0,
      model: modelId,
      status: 'completed',
      output: [reasoning, message],
      usage: { input_tokens: 3, output_tokens: 4 }
    }
    const requests: { input: unknown[] }[] = []
    const fetch: typeof globalThis.fetch = async (_url, init) => {
      requests.push(JSON.parse(String(init?.body)))
      if (requests.length !== 1 || mode === 'generate') return Response.json(reply)
      const events = [
        { type: 'response.output_item.added', output_index: 0, item: { ...reasoning, content: [] } },
        ...(mode === 'deltas'
          ? ['First thought. ', 'Second thought.'].map((delta) => ({
              type: 'response.reasoning_text.delta',
              item_id: reasoning.id,
              content_index: 0,
              delta
            }))
          : []),
        { type: 'response.output_item.done', output_index: 0, item: reasoning },
        { type: 'response.output_item.added', output_index: 1, item: { ...message, content: [] } },
        { type: 'response.output_text.delta', item_id: message.id, delta: 'Visible reply', logprobs: [] },
        { type: 'response.output_item.done', output_index: 1, item: message },
        { type: 'response.completed', response: reply }
      ]
      return new Response(`${events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('')}data: [DONE]\n\n`, {
        headers: { 'content-type': 'text/event-stream' }
      })
    }
    const modelAt = async (baseURL: string) =>
      wrapLanguageModel({
        model: createOpenAI({ apiKey: 'fixture', baseURL, fetch }).responses(modelId),
        middleware: await middleware(ENDPOINT_TYPE.OPENAI_RESPONSES, 'openai', modelId, baseURL)
      })
    const providerOptions = { openai: { store: false } }
    const first = { model: await modelAt(origin), prompt: 'First', providerOptions, maxRetries: 0 }
    let history: ModelMessage[]
    if (mode === 'generate') {
      history = (await generateText(first)).response.messages
    } else if (mode === 'deltas') {
      const result = streamText(first)
      await result.consumeStream()
      history = (await result.response).messages
    } else {
      let persisted: CherryUIMessage | undefined
      const stream = withReasoningTimingMetadata(streamText(first).toUIMessageStream())
      for await (const message of readUIMessageStream<CherryUIMessage>({ stream })) persisted = message
      if (!persisted) throw new Error('Expected an assistant reply')
      history = await toModelMessages([
        JSON.parse(JSON.stringify({ ...persisted, parts: dropEmptyContentParts(persisted.parts) }))
      ])
    }
    const messages: ModelMessage[] = [
      { role: 'user', content: 'First' },
      ...history,
      { role: 'user', content: 'Second' }
    ]
    for (const baseURL of [origin, other, origin]) {
      await generateText({ model: await modelAt(baseURL), messages, providerOptions, maxRetries: 0 })
      const input = requests.at(-1)!.input
      expect(JSON.stringify(input)).toContain('Visible reply')
      expect(
        input.filter((item) => item && typeof item === 'object' && 'type' in item && item.type === 'reasoning')
      ).toEqual(
        baseURL === origin
          ? [
              expect.objectContaining({
                type: 'reasoning',
                summary: [],
                encrypted_content: reasoning.encrypted_content,
                ...(content.length > 0 && { content })
              })
            ]
          : []
      )
    }
  }
)

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

it.each([
  ['generate', 'Thinking summary'],
  ['generate', ''],
  ['stream', 'Thinking summary'],
  ['stream', '']
])('replays compatible Chat ciphertext from %s with summary %j only on its source route', async (mode, summary) => {
  const modelId = 'fixture-model'
  const encryptedContent = 'fixture-encrypted-state'
  const response = { id: 'reply', created: 1, model: modelId }
  const requests: unknown[] = []
  const fetch: typeof globalThis.fetch = async (_url, init) => {
    requests.push(JSON.parse(String(init?.body)))
    const content = 'Visible reply'
    if (mode === 'stream' && requests.length === 1) {
      const chunks = [
        { delta: { reasoning_content: summary }, finish_reason: null },
        { delta: { content: '', reasoning_content: '', encrypted_content: encryptedContent }, finish_reason: null },
        { delta: { content }, finish_reason: null },
        { delta: {}, finish_reason: 'stop' }
      ].map((choice) => `data: ${JSON.stringify({ ...response, choices: [{ index: 0, ...choice }] })}\n\n`)
      return new Response(`${chunks.join('')}data: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } })
    }
    return Response.json({
      ...response,
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content, reasoning_content: summary, encrypted_content: encryptedContent },
          finish_reason: 'stop'
        }
      ]
    })
  }
  const modelAt = async (baseURL: string) =>
    wrapLanguageModel({
      model: createOpenAICompatible({ name: 'fixture', baseURL, fetch })(modelId),
      middleware: await middleware(ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS, 'fixture', modelId, baseURL)
    })
  const first = { model: await modelAt(origin), prompt: 'First', maxRetries: 0 }
  let history: ModelMessage[]
  if (mode === 'stream') {
    let reply: CherryUIMessage | undefined
    const stream = withReasoningTimingMetadata(streamText(first).toUIMessageStream())
    for await (const message of readUIMessageStream<CherryUIMessage>({ stream })) {
      reply = message
    }
    if (!reply) throw new Error('Expected an assistant reply')
    history = await toModelMessages([
      JSON.parse(JSON.stringify({ ...reply, parts: dropEmptyContentParts(reply.parts) }))
    ])
  } else {
    history = (await generateText(first)).response.messages
  }
  const messages: ModelMessage[] = [{ role: 'user', content: 'First' }, ...history, { role: 'user', content: 'Second' }]
  for (const baseURL of [origin, other, origin]) {
    await generateText({ model: await modelAt(baseURL), messages, maxRetries: 0 })
    const body = requests.at(-1)
    expect(body).toMatchObject({
      messages: expect.arrayContaining([
        expect.objectContaining({
          role: 'assistant',
          content: 'Visible reply',
          reasoning_content: baseURL === origin ? summary : '',
          ...(baseURL === origin && { encrypted_content: encryptedContent })
        })
      ])
    })
    if (baseURL === other) expect(JSON.stringify(body)).not.toContain('encrypted_content')
  }
})
