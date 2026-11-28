import {
  convertToModelMessages,
  generateText,
  type LanguageModelMiddleware,
  readUIMessageStream,
  streamText,
  wrapLanguageModel
} from 'ai'
import { describe, expect, it } from 'vitest'

import type { AiRequestContext } from '@cherrystudio/ai-core'
import { createCherryIn } from '@cherrystudio/ai-sdk-provider'
import type { CherryUIMessage } from '@shared/data/types/message'
import { ENDPOINT_TYPE, type UniqueModelId } from '@shared/data/types/model'

import { makeModel } from '../../../../../__tests__/fixtures'
import { toModelMessages } from '../../../../../messages/messageRules'
import { captureWithFetch } from '../../../../../provider/custom/__tests__/boundary/captureRequest'
import { collectFromFeatures } from '../../collectFromFeatures'
import type { RequestScope } from '../../scope'
import { INTERNAL_FEATURES } from '../internalFeatures'

const FLASH = 'cherryin::google/gemini-3.8-flash'
const ARGON = 'cherryin::google/gemini-4-argon'

async function geminiMiddleware(target: UniqueModelId, baseURL: string, history: CherryUIMessage[] = []) {
  const modelId = target.slice('cherryin::'.length)
  const scope = {
    replayRouteId: `${target}:${baseURL}`,
    request: { conversation: { id: 'test', topicId: 'test' }, messages: history },
    model: makeModel({ id: target, apiModelId: modelId, providerId: 'cherryin' }),
    endpointType: ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT,
    sdkConfig: { providerId: 'cherryin', modelId, providerSettings: { geminiBaseURL: baseURL } }
  } as RequestScope
  const features = INTERNAL_FEATURES.filter((feature) => feature.name === 'conversation-state-replay')
  const { modelAdapters } = collectFromFeatures(scope, features)
  const middlewares: LanguageModelMiddleware[] = []
  for (const adapter of modelAdapters) {
    await adapter.configureContext?.({ middlewares } as AiRequestContext)
  }
  return middlewares
}

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
  const middlewares = await geminiMiddleware(target, 'https://first.invalid/v1beta', history)

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
  it.each(['generate', 'stream'])('replays Gemini state from a %s reply only on its serving route', async (mode) => {
    const source = 'https://first.invalid/v1beta'
    const other = 'https://second.invalid/v1beta'
    const modelId = FLASH.slice('cherryin::'.length)
    const modelAt = async (baseURL: string, fetch: typeof globalThis.fetch, history?: CherryUIMessage[]) =>
      wrapLanguageModel({
        model: createCherryIn({ apiKey: 'fixture', geminiBaseURL: baseURL, endpointType: 'gemini', fetch })(modelId),
        middleware: await geminiMiddleware(FLASH, baseURL, history)
      })
    const parts = [
      { text: 'Original thinking', thought: true, thoughtSignature: 'signed-thought' },
      { text: 'Original answer', thoughtSignature: 'signed-text' }
    ]
    const candidate = { content: { role: 'model', parts }, finishReason: 'STOP' }
    const first = {
      model: await modelAt(source, async () => {
        if (mode === 'generate') return Response.json({ candidates: [candidate] })
        const chunks = [
          { content: { role: 'model', parts: [parts[0], { text: 'Original answer' }] } },
          { content: { role: 'model', parts: [{ text: '', thoughtSignature: 'signed-text' }] }, finishReason: 'STOP' }
        ].map((chunk) => `data: ${JSON.stringify({ candidates: [chunk] })}\n\n`)
        return new Response(chunks.join(''), {
          headers: { 'content-type': 'text/event-stream' }
        })
      }),
      prompt: 'First question',
      maxRetries: 0
    }
    const history: CherryUIMessage[] = [{ id: 'question', role: 'user', parts: [{ type: 'text', text: first.prompt }] }]
    const followUp: CherryUIMessage = { id: 'follow-up', role: 'user', parts: [{ type: 'text', text: 'Follow-up' }] }
    let reply: CherryUIMessage | undefined
    if (mode === 'stream') {
      for await (const message of readUIMessageStream<CherryUIMessage>({
        stream: streamText(first).toUIMessageStream()
      })) {
        reply = message
      }
      if (!reply) throw new Error('Expected an assistant reply')
      history.push({ ...JSON.parse(JSON.stringify(reply)), metadata: { modelId: ARGON } }, followUp)
    }
    const messages = reply
      ? await toModelMessages(history)
      : ([
          { role: 'user', content: 'First question' },
          ...(await generateText(first)).response.messages,
          { role: 'user', content: 'Follow-up' }
        ] as const)
    for (const baseURL of [other, source]) {
      const { body } = await captureWithFetch(async (fetch) =>
        generateText({ model: await modelAt(baseURL, fetch, history), messages: [...messages], maxRetries: 0 })
      )
      expect(body).toMatchObject({
        contents: [
          {},
          {
            role: 'model',
            parts:
              baseURL === source
                ? [{ text: 'Original thinking' }, { text: 'Original answer' }]
                : [{ text: 'Original answer' }]
          },
          {}
        ]
      })
      if (baseURL === source) {
        expect(JSON.stringify(body)).toContain('signed-thought')
        expect(JSON.stringify(body)).toContain('signed-text')
      } else {
        expect(JSON.stringify(body)).not.toContain('thoughtSignature')
      }
    }
  })

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
