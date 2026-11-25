import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { LanguageModelV3CallOptions } from '@ai-sdk/provider'
import { wrapLanguageModel } from 'ai'
import { describe, expect, it } from 'vitest'

import type { AiRequestContext } from '@cherrystudio/ai-core'
import { ENDPOINT_TYPE } from '@shared/data/types/model'

import { makeModel } from '../../../../../__tests__/fixtures'
import type { RequestScope } from '../../scope'
import { conversationStateReplayFeature } from '../conversationStateReplay'
import { skipGeminiThoughtSignatureFeature } from '../skipGeminiThoughtSignature'

describe('Gemini thought signatures', () => {
  it.each([undefined, 'original-signature'])(
    'preserves existing signatures and fills only missing ones (%s)',
    async (signature) => {
      const scope = { model: makeModel({ apiModelId: 'google/gemini-4-argon' }) } as RequestScope
      expect(skipGeminiThoughtSignatureFeature.applies?.(scope)).toBe(true)
      const context = { middlewares: [] } as unknown as AiRequestContext
      const plugin = skipGeminiThoughtSignatureFeature.contributeModelAdapters!(scope)[0]
      await plugin.configureContext!(context)
      const params: LanguageModelV3CallOptions = {
        prompt: [
          {
            role: 'assistant',
            content: [
              {
                type: 'tool-call',
                toolCallId: 'call-1',
                toolName: 'lookup',
                input: '{}',
                providerOptions: {
                  google: { thoughtSignature: 'native-signature' },
                  openaiCompatible: {
                    extra_content: {
                      sibling: 'kept',
                      google: {
                        marker: 'kept',
                        ...(signature ? { thought_signature: signature } : {})
                      }
                    }
                  }
                }
              }
            ]
          }
        ]
      }
      // oxlint-disable-next-line no-restricted-globals -- Isolate synthetic fixture data from later test mutations.
      const original = structuredClone(params)
      const model = createOpenAICompatible({ name: 'gateway', baseURL: 'https://gateway.test' })('gemini-4-argon')
      const transformed = await context.middlewares![0].transformParams!({ params, model, type: 'generate' })
      expect(transformed.prompt[0]).toMatchObject({
        content: [
          {
            providerOptions: {
              google: { thoughtSignature: 'native-signature' },
              openaiCompatible: {
                extra_content: {
                  sibling: 'kept',
                  google: { marker: 'kept', thought_signature: signature ?? 'native-signature' }
                }
              }
            }
          }
        ]
      })
      expect(params).toEqual(original)
    }
  )

  it('replays a Gemini compatible tool signature only on the serving route', async () => {
    const origin = 'https://origin.invalid/v1'
    const foreign = 'https://foreign.invalid/v1'
    const modelId = 'gemini-3-flash-preview'
    const requests: unknown[] = []
    const modelAt = async (baseURL: string, wireModel = modelId) => {
      const scope = {
        request: {},
        provider: { id: 'fixture' },
        model: makeModel({ apiModelId: wireModel }),
        endpointType: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
        sdkConfig: { providerId: 'openai-compatible', modelId: wireModel, providerSettings: { baseURL } }
      } as RequestScope
      const context = { middlewares: [] } as unknown as AiRequestContext
      for (const feature of [conversationStateReplayFeature, skipGeminiThoughtSignatureFeature]) {
        if (!feature.applies?.(scope)) continue
        for (const plugin of feature.contributeModelAdapters?.(scope) ?? []) await plugin.configureContext?.(context)
      }
      const model = createOpenAICompatible({
        name: 'fixture',
        baseURL,
        fetch: async (_url, init) => {
          requests.push(JSON.parse(String(init?.body)))
          return Response.json({
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
        }
      })(wireModel)
      return wrapLanguageModel({ model, middleware: context.middlewares ?? [] })
    }
    const user = { role: 'user', content: [{ type: 'text', text: 'Look it up' }] } as const
    const first = await (await modelAt(origin)).doGenerate({ prompt: [{ ...user, content: [...user.content] }] })
    const call = first.content.find((part) => part.type === 'tool-call')!
    const prompt: LanguageModelV3CallOptions['prompt'] = [
      { ...user, content: [...user.content] },
      { role: 'assistant', content: [{ ...call, input: {}, providerOptions: call.providerMetadata }] },
      {
        role: 'tool',
        content: [
          { type: 'tool-result', toolCallId: 'call-1', toolName: 'lookup', output: { type: 'text', value: '42' } }
        ]
      },
      { role: 'user', content: [{ type: 'text', text: 'Continue' }] }
    ]
    for (const [baseURL, wireModel] of [
      [foreign, modelId],
      [origin, 'another-model'],
      [origin, modelId]
    ]) {
      await (await modelAt(baseURL, wireModel)).doGenerate({ prompt })
      expect(requests.at(-1)).toMatchObject({
        messages: expect.arrayContaining([
          expect.objectContaining({ role: 'assistant', tool_calls: [expect.objectContaining({ id: 'call-1' })] }),
          expect.objectContaining({ role: 'tool', tool_call_id: 'call-1', content: '42' })
        ])
      })
      expect(JSON.stringify(requests.at(-1))).not.toContain('skip_thought_signature_validator')
      expect(JSON.stringify(requests.at(-1)).includes('serving-signature')).toBe(
        baseURL === origin && wireModel === modelId
      )
    }
  })
})
