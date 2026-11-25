import { createAnthropic } from '@ai-sdk/anthropic'
import type { LanguageModelV3CallOptions } from '@ai-sdk/provider'
import { wrapLanguageModel } from 'ai'
import { describe, expect, it } from 'vitest'

import { type AiRequestContext, fromAISDK, toAISDK } from '@cherrystudio/ai-core'
import { DEFAULT_CONTEXT_SETTINGS } from '@shared/data/types/contextSettings'
import type { CherryUIMessage } from '@shared/data/types/message'
import { ENDPOINT_TYPE } from '@shared/data/types/model'

import { omitCompactedAnthropicThinking } from '../../../../messages/anthropicThinking'
import { toModelMessages } from '../../../../messages/messageRules'
import { anthropicThinkingBindingFeature } from '../../../../runtime/aiSdk/params/features/anthropicThinkingBinding'
import { buildContextOptions } from '../../../../runtime/aiSdk/params/features/contextBuild'
import type { RequestScope } from '../../../../runtime/aiSdk/params/scope'
import { dropEmptyContentParts } from '../../../../streamManager/persistence/PersistenceBackend'

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
