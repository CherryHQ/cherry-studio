import { convertToModelMessages, generateText, type LanguageModelMiddleware, wrapLanguageModel } from 'ai'
import { describe, expect, it } from 'vitest'

import type { AiRequestContext } from '@cherrystudio/ai-core'
import { createCherryIn } from '@cherrystudio/ai-sdk-provider'
import type { CherryUIMessage } from '@shared/data/types/message'
import { ENDPOINT_TYPE } from '@shared/data/types/model'

import { makeModel } from '../../../../../__tests__/fixtures'
import { captureWithFetch } from '../../../../../provider/custom/__tests__/boundary/captureRequest'
import { collectFromFeatures } from '../../collectFromFeatures'
import type { RequestScope } from '../../scope'
import { INTERNAL_FEATURES } from '../internalFeatures'

const FLASH = 'cherryin::google/gemini-3.8-flash'
const ARGON = 'cherryin::google/gemini-4-argon'

async function captureGeminiReplay(
  target: typeof FLASH | typeof ARGON,
  source = FLASH,
  currentTurn = false,
  textOnly = false
) {
  const history: CherryUIMessage[] = [
    { id: 'user', role: 'user', parts: [{ type: 'text', text: 'Look up maple' }] },
    {
      id: 'answer',
      role: 'assistant',
      metadata: { modelId: source },
      parts: [
        {
          type: 'tool-lookup',
          state: 'output-available',
          toolCallId: 'old-call',
          input: { item: 'maple' },
          output: { code: 42 },
          callProviderMetadata: { google: { thoughtSignature: 'maple-signature' } }
        },
        {
          type: 'tool-lookup',
          state: 'output-available',
          toolCallId: 'parallel-call',
          input: { item: 'oak' },
          output: { code: 43 }
        }
      ]
    }
  ]
  const signedText = {
    type: 'text',
    text: 'The maple code is 42.',
    providerMetadata: { google: { thoughtSignature: 'reply-signature' } }
  } as const
  history[1].parts = textOnly ? [signedText] : [...history[1].parts, { type: 'step-start' }, signedText]
  if (!currentTurn) {
    history.push({ id: 'follow-up', role: 'user', parts: [{ type: 'text', text: 'Look up cedar' }] })
  }

  const modelId = target.slice('cherryin::'.length)
  const scope = {
    request: { conversation: { id: 'test', topicId: 'test' }, messages: history },
    model: makeModel({ id: target, apiModelId: modelId, providerId: 'cherryin' }),
    endpointType: ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT
  } as RequestScope
  const features = INTERNAL_FEATURES.filter((feature) => feature.name === 'gemini-history-signature-replay')
  const { modelAdapters } = collectFromFeatures(scope, features)
  const middlewares: LanguageModelMiddleware[] = []
  for (const adapter of modelAdapters) {
    await adapter.configureContext?.({ middlewares } as AiRequestContext)
  }

  const prompt = await convertToModelMessages(history)
  return captureWithFetch((fetch) => {
    const model = createCherryIn({ apiKey: 'test', endpointType: 'gemini', fetch })(modelId)
    return generateText({
      model: wrapLanguageModel({ model, middleware: middlewares }),
      messages: prompt,
      maxRetries: 0
    })
  })
}

describe('Gemini history signature replay', () => {
  it('omits foreign signatures on completed history and keeps tool calls and results', async () => {
    const { body } = await captureGeminiReplay(ARGON)
    expect(body).toMatchObject({
      contents: [
        { role: 'user', parts: [{ text: 'Look up maple' }] },
        {
          role: 'model',
          parts: [
            { functionCall: { id: 'old-call', name: 'lookup', args: { item: 'maple' } } },
            { functionCall: { id: 'parallel-call', name: 'lookup', args: { item: 'oak' } } }
          ]
        },
        {
          role: 'user',
          parts: [
            { functionResponse: { id: 'old-call', response: { content: { code: 42 } } } },
            { functionResponse: { id: 'parallel-call', response: { content: { code: 43 } } } }
          ]
        },
        { role: 'model', parts: [{ text: 'The maple code is 42.' }] },
        { role: 'user', parts: [{ text: 'Look up cedar' }] }
      ]
    })
    expect(JSON.stringify(body)).not.toContain('thoughtSignature')
  })

  it('omits the old text signature even when history has no tool calls and the model slug matches', async () => {
    const { body } = await captureGeminiReplay(FLASH, 'other-connection::google/gemini-3.8-flash', false, true)
    expect(body).toMatchObject({ contents: [{}, { role: 'model', parts: [{ text: 'The maple code is 42.' }] }, {}] })
    expect(JSON.stringify(body)).not.toContain('thoughtSignature')
  })

  it.each([
    [FLASH, FLASH, false],
    [ARGON, FLASH, true],
    [ARGON, 'unknown', false]
  ] as const)('preserves signatures for %s with source %s and current turn %s', async (target, source, currentTurn) => {
    const { body } = await captureGeminiReplay(target, source, currentTurn)
    expect(JSON.stringify(body)).toContain('"thoughtSignature":"maple-signature"')
    expect(JSON.stringify(body)).toContain('"thoughtSignature":"reply-signature"')
    expect(JSON.stringify(body)).not.toContain('skip_thought_signature_validator')
  })
})
