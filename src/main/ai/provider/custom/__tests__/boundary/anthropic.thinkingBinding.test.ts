import { createAnthropic } from '@ai-sdk/anthropic'
import type { LanguageModelV3CallOptions } from '@ai-sdk/provider'
import { generateText, type ModelMessage, wrapLanguageModel } from 'ai'
import { describe, expect, it } from 'vitest'

import { type AiRequestContext, fromAISDK, toAISDK } from '@cherrystudio/ai-core'
import { DEFAULT_CONTEXT_SETTINGS } from '@shared/data/types/contextSettings'
import type { CherryUIMessage } from '@shared/data/types/message'
import { ENDPOINT_TYPE } from '@shared/data/types/model'

import { makeModel } from '../../../../__tests__/fixtures'
import { omitCompactedAnthropicThinking } from '../../../../messages/anthropicThinking'
import { toModelMessages } from '../../../../messages/messageRules'
import {
  anthropicThinkingBindingFeature,
  anthropicThinkingReplayFeature
} from '../../../../runtime/aiSdk/params/features/anthropicThinkingBinding'
import { buildContextOptions } from '../../../../runtime/aiSdk/params/features/contextBuild'
import { conversationStateReplayFeature } from '../../../../runtime/aiSdk/params/features/conversationStateReplay'
import type { RequestScope } from '../../../../runtime/aiSdk/params/scope'
import { dropEmptyContentParts } from '../../../../streamManager/persistence/PersistenceBackend'
import { createAihubmix } from '../../aihubmix/aihubmixProvider'

const modelId = 'claude-sonnet-5-5'
const directURL = 'https://api.anthropic.com/v1'
const beta = 'thinking-binding-controls-2026-08-01'
const question = { role: 'user', content: [{ type: 'text', text: 'Earlier question.' }] } as const
const prompt: LanguageModelV3CallOptions['prompt'] = [
  { ...question, content: [...question.content] },
  {
    role: 'assistant',
    content: [
      { type: 'reasoning', text: '', providerOptions: { anthropic: { signature: 'signed-by-claude' } } },
      { type: 'text', text: 'Earlier answer.' }
    ]
  },
  { role: 'user', content: [{ type: 'text', text: 'Follow up.' }] }
]

async function send({
  baseURL = directURL,
  wireModel = modelId,
  contextOwner,
  callOptions
}: {
  baseURL?: string
  wireModel?: string
  contextOwner?: 'caller'
  callOptions?: Partial<LanguageModelV3CallOptions>
} = {}) {
  const scope = {
    request: { contextOwner },
    sdkConfig: { providerId: 'anthropic', modelId: wireModel, providerSettings: { baseURL } }
  } as unknown as RequestScope
  let body: unknown
  let headers = new Headers()
  const sdkModel = createAnthropic({
    apiKey: 'test',
    baseURL,
    fetch: async (_url, init) => {
      body = JSON.parse(String(init?.body))
      headers = new Headers(init?.headers)
      return Response.json({
        id: 'message',
        type: 'message',
        role: 'assistant',
        model: wireModel,
        content: [{ type: 'text', text: 'Answer.' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 10, output_tokens: 5 }
      })
    }
  })(wireModel)
  const context = { middlewares: [] } as unknown as AiRequestContext
  if (anthropicThinkingBindingFeature.applies?.(scope)) {
    for (const plugin of anthropicThinkingBindingFeature.contributeModelAdapters?.(scope) ?? []) {
      await plugin.configureContext?.(context)
    }
  }
  const model = context.middlewares?.length
    ? wrapLanguageModel({ model: sdkModel, middleware: context.middlewares })
    : sdkModel
  await model.doGenerate({ prompt, ...callOptions })
  return { body, headers }
}

describe('Anthropic Messages thinking binding', () => {
  it('keeps Anthropic state on its AiHubMix route across URL and protocol changes', async () => {
    const originalUrl = 'https://fixture.invalid/anthropic/v1'
    const anotherUrl = 'https://fixture.invalid/other/v1'
    const signed = { type: 'thinking', thinking: '', signature: 'signed-original' }
    const redacted = { type: 'redacted_thinking', data: 'opaque-original' }
    const thought = { type: 'thinking', thinking: 'Private thinking', signature: 'signed-thinking' }
    const state = [signed, redacted, thought]
    const answer = { type: 'text', text: 'Visible reply' }
    const requests: Array<{ url: string; body: unknown }> = []
    const modelAt = async (baseURL: string, isAnthropic = true) => {
      const endpointType = isAnthropic ? ENDPOINT_TYPE.ANTHROPIC_MESSAGES : ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT
      const wireModel = isAnthropic ? modelId : 'gemini-3-flash-preview'
      const providerSettings = {
        apiKey: 'fixture',
        baseURL: 'https://fixture.invalid/v1',
        endpointBaseURLs: { [endpointType]: baseURL },
        fetch: async (url, init) => {
          requests.push({ url: String(url), body: JSON.parse(String(init?.body)) })
          if (!isAnthropic) {
            return Response.json({
              candidates: [{ content: { role: 'model', parts: [{ text: 'Gemini answer' }] }, finishReason: 'STOP' }]
            })
          }
          return Response.json({
            id: 'message',
            type: 'message',
            role: 'assistant',
            model: modelId,
            content: [...state, answer],
            stop_reason: 'end_turn',
            usage: { input_tokens: 10, output_tokens: 5 }
          })
        }
      } satisfies Parameters<typeof createAihubmix>[0]
      const scope = {
        replayRouteId: `${wireModel}:${baseURL}`,
        request: {},
        provider: { id: 'aihubmix' },
        model: makeModel({ id: `aihubmix::${wireModel}`, apiModelId: wireModel, providerId: 'aihubmix' }),
        endpointType,
        sdkConfig: { modelId: wireModel, providerId: 'aihubmix', providerSettings }
      } as RequestScope
      const context = { middlewares: [] } as unknown as AiRequestContext
      const feature = isAnthropic ? anthropicThinkingReplayFeature : conversationStateReplayFeature
      if (feature.applies?.(scope)) {
        for (const plugin of feature.contributeModelAdapters?.(scope) ?? []) {
          await plugin.configureContext?.(context)
        }
      }
      return wrapLanguageModel({
        model: createAihubmix(providerSettings)(wireModel),
        middleware: context.middlewares ?? []
      })
    }

    const first = await generateText({ model: await modelAt(originalUrl), prompt: 'Question', maxRetries: 0 })
    const messages: ModelMessage[] = [
      { role: 'user', content: 'Question' },
      ...first.response.messages,
      { role: 'user', content: 'Follow-up' }
    ]
    await generateText({
      model: await modelAt('https://fixture.invalid/gemini/v1beta', false),
      messages,
      maxRetries: 0
    })
    expect(requests.at(-1)?.body).toMatchObject({
      contents: [{}, { role: 'model', parts: [{ text: answer.text }] }, {}]
    })
    for (const baseURL of [anotherUrl, originalUrl]) {
      await generateText({
        model: await modelAt(baseURL),
        messages,
        maxRetries: 0
      })
      expect(requests.at(-1)).toMatchObject({
        url: `${baseURL}/messages`,
        body: {
          messages: [
            { role: 'user' },
            { role: 'assistant', content: baseURL === originalUrl ? [...state, answer] : [answer] },
            { role: 'user' }
          ]
        }
      })
    }
  })

  it('sends the original signed thinking and delegates prefix mismatch handling to Claude', async () => {
    const { body, headers } = await send({
      callOptions: { providerOptions: { anthropic: { thinking: { type: 'adaptive', display: 'summarized' } } } }
    })
    expect(body).toMatchObject({
      thinking: {
        type: 'adaptive',
        display: 'summarized',
        block_binding: { prefix_mismatch_behavior: 'drop_block' }
      },
      messages: expect.arrayContaining([
        {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: '', signature: 'signed-by-claude' },
            { type: 'text', text: 'Earlier answer.' }
          ]
        }
      ])
    })
    expect(headers.get('anthropic-beta')).toContain(beta)
  })

  it.each([
    { baseURL: 'https://gateway.example/v1' },
    { baseURL: 'https://api.anthropic.com.gateway.example/v1' },
    { wireModel: 'claude-sonnet-4-6' },
    { contextOwner: 'caller' as const },
    { callOptions: { prompt: [prompt[0]] } },
    { callOptions: { providerOptions: { anthropic: { thinking: { type: 'between_tools' } } } } },
    { callOptions: { providerOptions: { anthropic: { sendReasoning: false } } } }
  ])('keeps the beta off for an ineligible request %#', async (options) => {
    const { body, headers } = await send(options)
    expect(headers.get('anthropic-beta') ?? '').not.toContain(beta)
    expect(JSON.stringify(body)).not.toContain('block_binding')
  })

  it('leaves an explicit prefix-error policy in place', async () => {
    const { body } = await send({
      callOptions: {
        providerOptions: {
          anthropic: { thinking: { type: 'adaptive', blockBinding: { prefixMismatchBehavior: 'error' } } }
        }
      }
    })
    expect(body).toMatchObject({ thinking: { block_binding: { prefix_mismatch_behavior: 'error' } } })
  })

  it('keeps the compacted tail and tool result valid on a compatible endpoint', async () => {
    const compacted: LanguageModelV3CallOptions['prompt'] = [
      { role: 'user', content: [{ type: 'text', text: 'Summary of earlier messages.' }] },
      {
        role: 'assistant',
        content: [{ type: 'reasoning', text: '', providerOptions: { anthropic: { signature: 'thinking-only' } } }]
      },
      { role: 'user', content: [{ type: 'text', text: 'Please look this up.' }] },
      {
        role: 'assistant',
        content: [
          {
            type: 'reasoning',
            text: '',
            providerOptions: { anthropic: { redactedData: 'redacted-before-compaction' } }
          },
          { type: 'tool-call', toolName: 'lookup', toolCallId: 'tool-one', input: { query: 'date' } }
        ]
      },
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolName: 'lookup',
            toolCallId: 'tool-one',
            output: { type: 'text', value: 'Found it.' }
          }
        ]
      }
    ]
    const { body, headers } = await send({
      baseURL: 'https://gateway.example/v1',
      callOptions: {
        prompt: omitCompactedAnthropicThinking(compacted),
        tools: [{ type: 'function', name: 'lookup', inputSchema: { type: 'object' } }]
      }
    })
    expect(headers.get('anthropic-beta') ?? '').not.toContain(beta)
    expect(body).toMatchObject({
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Summary of earlier messages.' },
            { type: 'text', text: 'Please look this up.' }
          ]
        },
        {
          role: 'assistant',
          content: [{ type: 'tool_use', id: 'tool-one', name: 'lookup', input: { query: 'date' } }]
        },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tool-one' }] }
      ]
    })
    expect(JSON.stringify(body)).not.toContain('redacted-before-compaction')
    expect(JSON.stringify(compacted)).toContain('redacted-before-compaction')
  })

  it.each([
    ['cherryin', 'anthropic/claude-sonnet-5.5', ENDPOINT_TYPE.ANTHROPIC_MESSAGES, true],
    ['cherryin', 'gpt-4o', ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS, false],
    ['aihubmix', modelId, ENDPOINT_TYPE.ANTHROPIC_MESSAGES, true],
    ['aihubmix', modelId, ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS, true],
    ['aihubmix', 'gpt-4o', ENDPOINT_TYPE.ANTHROPIC_MESSAGES, false]
  ] as const)(
    'applies sliding-window thinking rules for %s model %s with %s configured',
    async (providerId, wireModel, endpointType, stripsThinking) => {
      const scope = {
        aiSdkProviderId: providerId,
        endpointType,
        sdkConfig: { modelId: wireModel },
        request: { conversation: { id: 'topic' } },
        model: { id: `${providerId}::${wireModel}`, contextWindow: 8_000 },
        contextSettings: DEFAULT_CONTEXT_SETTINGS,
        compressionModel: null,
        registry: { getAll: () => [] }
      } as unknown as RequestScope
      const trim = buildContextOptions(scope)?.onBeforeCompress
      if (!trim) throw new Error('Expected the sliding-window fallback')

      const oldText = 'Large earlier input. '.repeat(2_000)
      const history = fromAISDK([
        { role: 'user', content: [{ type: 'text', text: oldText }] },
        ...prompt,
        { role: 'assistant', content: [{ type: 'text', text: 'Keep this answer.' }] }
      ])
      const unchanged = await trim(history, { currentTokens: 1_000, limit: 8_000 })
      expect(JSON.stringify(toAISDK(unchanged ?? []))).toContain('signed-by-claude')

      const kept = await trim(history, { currentTokens: 12_000, limit: 8_000 })
      const trimmed = JSON.stringify(toAISDK(kept ?? []))
      expect(trimmed).not.toContain(oldText)
      expect(trimmed).toContain('Earlier answer.')
      expect(trimmed).toContain('Keep this answer.')
      expect(trimmed.includes('signed-by-claude')).toBe(!stripsThinking)
    }
  )

  it('persists and replays empty signed and redacted thinking without local fingerprints', async () => {
    const assistant: CherryUIMessage = {
      role: 'assistant',
      id: 'reply',
      parts: [
        { type: 'reasoning', text: '', providerMetadata: { anthropic: { signature: 'signed-by-claude' } } },
        { type: 'reasoning', text: '', providerMetadata: { anthropic: { redactedData: 'opaque' } } },
        { type: 'text', text: 'Answer.' }
      ]
    }
    const messages = await toModelMessages(
      [{ ...assistant, parts: dropEmptyContentParts(assistant.parts) }],
      undefined,
      undefined,
      undefined,
      true
    )
    expect(messages).toMatchObject([
      {
        role: 'assistant',
        content: [
          { type: 'reasoning', text: '', providerOptions: { anthropic: { signature: 'signed-by-claude' } } },
          { type: 'reasoning', text: '', providerOptions: { anthropic: { redactedData: 'opaque' } } },
          { type: 'text', text: 'Answer.' }
        ]
      }
    ])
  })
})
