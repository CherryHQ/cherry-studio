import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { LanguageModelV3CallOptions, SharedV3ProviderOptions } from '@ai-sdk/provider'
import { wrapLanguageModel } from 'ai'
import { expect, it } from 'vitest'

import type { AiRequestContext } from '@cherrystudio/ai-core'
import type { CherryUIMessage } from '@shared/data/types/message'
import { ENDPOINT_TYPE } from '@shared/data/types/model'

import { makeModel } from '../../../../../__tests__/fixtures'
import { captureWithFetch } from '../../../../../provider/custom/__tests__/boundary/captureRequest'
import type { RequestScope } from '../../scope'
import { conversationStateReplayFeature } from '../conversationStateReplay'

const origin = 'https://origin.invalid/v1'
const models = ['gemini-3-flash-preview', 'gemini-4-argon'] as const
const firstUser = {
  role: 'user',
  content: [{ type: 'text', text: 'Look it up' }]
} satisfies LanguageModelV3CallOptions['prompt'][number]

async function modelAt(
  baseURL: string,
  wireModel: string,
  fetch: typeof globalThis.fetch,
  messages?: CherryUIMessage[]
) {
  const scope = {
    replayRouteId: `${wireModel}:${baseURL}`,
    request: { messages },
    provider: { id: 'fixture' },
    model: makeModel({ id: `fixture::${wireModel}`, apiModelId: wireModel }),
    endpointType: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
    sdkConfig: { providerId: 'openai-compatible', modelId: wireModel, providerSettings: { baseURL } }
  } as RequestScope
  const context = { middlewares: [] } as unknown as AiRequestContext
  for (const plugin of conversationStateReplayFeature.contributeModelAdapters?.(scope) ?? []) {
    await plugin.configureContext?.(context)
  }
  const model = createOpenAICompatible({ name: 'fixture', baseURL, fetch })(wireModel)
  return wrapLanguageModel({ model, middleware: context.middlewares ?? [] })
}

function toolHistory(
  callIds: string[],
  providerOptions?: SharedV3ProviderOptions
): LanguageModelV3CallOptions['prompt'] {
  return [
    firstUser,
    {
      role: 'assistant',
      content: callIds.map((toolCallId, index) => ({
        type: 'tool-call',
        toolCallId,
        toolName: 'lookup',
        input: {},
        ...(index === 0 && { providerOptions })
      }))
    },
    {
      role: 'tool',
      content: callIds.map((toolCallId) => ({
        type: 'tool-result',
        toolCallId,
        toolName: 'lookup',
        output: { type: 'text', value: '42' }
      }))
    }
  ]
}

it.each(models)(
  'replays both representations of the %s compatible signature only on the serving route',
  async (modelId) => {
    const fetch: typeof globalThis.fetch = async () =>
      Response.json({
        id: 'reply',
        created: 1,
        model: modelId,
        choices: [
          {
            index: 0,
            finish_reason: 'tool_calls',
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: 'call-1',
                  type: 'function',
                  function: { name: 'lookup', arguments: '{}' },
                  extra_content: { google: { thought_signature: 'serving-signature' } }
                }
              ]
            }
          }
        ]
      })
    const first = await (await modelAt(origin, modelId, fetch)).doGenerate({ prompt: [firstUser] })
    const call = first.content.find((part) => part.type === 'tool-call')!
    for (const providerOptions of [
      call.providerMetadata,
      {
        cherry: call.providerMetadata?.cherry ?? {},
        openaiCompatible: { extra_content: { google: { thought_signature: 'serving-signature' } } }
      }
    ]) {
      const prompt: LanguageModelV3CallOptions['prompt'] = [
        ...toolHistory(['call-1', 'unsigned-sibling'], providerOptions),
        { role: 'user', content: [{ type: 'text', text: 'Continue' }] }
      ]
      for (const [baseURL, wireModel] of [
        ['https://foreign.invalid/v1', modelId],
        [origin, 'another-model'],
        [origin, modelId]
      ]) {
        const { body } = await captureWithFetch(async (fetch) =>
          (await modelAt(baseURL, wireModel, fetch)).doGenerate({ prompt })
        )
        expect(body).toMatchObject({
          messages: expect.arrayContaining([
            expect.objectContaining({
              role: 'assistant',
              tool_calls: [
                expect.objectContaining({ id: 'call-1' }),
                expect.objectContaining({ id: 'unsigned-sibling' })
              ]
            }),
            expect.objectContaining({ role: 'tool', tool_call_id: 'call-1', content: '42' }),
            expect.objectContaining({ role: 'tool', tool_call_id: 'unsigned-sibling', content: '42' })
          ])
        })
        expect(JSON.stringify(body)).not.toContain('skip_thought_signature_validator')
        expect(JSON.stringify(body).includes('serving-signature')).toBe(baseURL === origin && wireModel === modelId)
      }
    }
  }
)

it.each(models)('uses the %s fallback only for calls without a usable signature', async (modelId) => {
  const { body } = await captureWithFetch(async (fetch) =>
    (await modelAt(origin, modelId, fetch)).doGenerate({ prompt: toolHistory(['solo']) })
  )
  expect(body).toMatchObject({
    messages: expect.arrayContaining([
      expect.objectContaining({
        tool_calls: [
          expect.objectContaining({
            id: 'solo',
            extra_content: { google: { thought_signature: 'skip_thought_signature_validator' } }
          })
        ]
      })
    ])
  })
  const { body: parallel } = await captureWithFetch(async (fetch) =>
    (await modelAt(origin, modelId, fetch)).doGenerate({
      prompt: toolHistory(['signed', 'unsigned'], {
        openaiCompatible: { extra_content: { sibling: 'kept', google: { thought_signature: 'original' } } }
      })
    })
  )
  expect(parallel).toMatchObject({
    messages: expect.arrayContaining([
      expect.objectContaining({
        tool_calls: [
          expect.objectContaining({
            id: 'signed',
            extra_content: { sibling: 'kept', google: { thought_signature: 'original' } }
          }),
          expect.objectContaining({ id: 'unsigned' })
        ]
      })
    ])
  })
  expect(JSON.stringify(parallel)).not.toContain('skip_thought_signature_validator')
})

it.each(models)(
  'does not backfill %s signatures for completed tool history from a different model',
  async (modelId) => {
    const history: CherryUIMessage[] = [
      {
        id: 'history',
        role: 'assistant',
        metadata: { modelId: 'other::other-model' },
        parts: [{ type: 'tool-lookup', state: 'output-available', toolCallId: 'foreign-call', input: {}, output: '42' }]
      }
    ]
    const prompt: LanguageModelV3CallOptions['prompt'] = [
      ...toolHistory(['foreign-call']),
      { role: 'user', content: [{ type: 'text', text: 'Continue' }] }
    ]
    const { body } = await captureWithFetch(async (fetch) =>
      (await modelAt(origin, modelId, fetch, history)).doGenerate({ prompt })
    )
    expect(JSON.stringify(body)).not.toContain('thought_signature')
    expect(body).toMatchObject({
      messages: expect.arrayContaining([
        expect.objectContaining({ tool_calls: [expect.objectContaining({ id: 'foreign-call' })] }),
        expect.objectContaining({ role: 'tool', tool_call_id: 'foreign-call', content: '42' })
      ])
    })
  }
)
