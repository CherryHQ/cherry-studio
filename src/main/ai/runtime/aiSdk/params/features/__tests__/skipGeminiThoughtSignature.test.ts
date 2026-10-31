import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { LanguageModelV3CallOptions } from '@ai-sdk/provider'
import { describe, expect, it } from 'vitest'

import type { AiRequestContext } from '@cherrystudio/ai-core'

import { makeModel } from '../../../../../__tests__/fixtures'
import type { RequestScope } from '../../scope'
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
                  google: { marker: 'kept', thought_signature: signature ?? 'skip_thought_signature_validator' }
                }
              }
            }
          }
        ]
      })
      expect(params).toEqual(original)
    }
  )
})
