import { createOpenAI } from '@ai-sdk/openai'
import type { LanguageModelV4CallOptions, LanguageModelV4StreamPart } from '@ai-sdk/provider'
import { wrapLanguageModel } from 'ai'
import { describe, expect, it } from 'vitest'

import { rewriteGrokCliResponsesBody } from '../../../../../provider/grokCli'
import { createGrokReasoningReplayMiddleware } from '../grokReasoningReplay'

const reasoning = { type: 'reasoning', id: 'rs_1', summary: [], encrypted_content: 'opaque' }
const prompt: LanguageModelV4CallOptions['prompt'] = [{ role: 'user', content: [{ type: 'text', text: 'Hello' }] }]
const providerOptions = { openai: { store: false, forceReasoning: true, reasoningEffort: 'high' } }

function createModel(providerId = 'grok-cli', modelId = 'grok-4.7', streaming = false) {
  const requests: Record<string, any>[] = []
  const model = createOpenAI({
    apiKey: 'test',
    fetch: async (_input, init) => {
      const body = JSON.parse(init!.body as string)
      requests.push(providerId === 'grok-cli' ? rewriteGrokCliResponsesBody(body) : body)
      const response = {
        id: 'resp_1',
        created_at: 0,
        model: modelId,
        status: 'completed',
        output: [reasoning],
        usage: { input_tokens: 1, output_tokens: 1 }
      }
      if (!streaming) return new Response(JSON.stringify(response), { headers: { 'content-type': 'application/json' } })
      const events = [
        { type: 'response.output_item.added', output_index: 0, item: { ...reasoning, encrypted_content: null } },
        { type: 'response.output_item.done', output_index: 0, item: reasoning },
        { type: 'response.completed', response }
      ]
      return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''), {
        headers: { 'content-type': 'text/event-stream' }
      })
    }
  }).responses(modelId)
  return {
    requests,
    model: wrapLanguageModel({ model, middleware: createGrokReasoningReplayMiddleware(providerId, modelId) })
  }
}

describe('Grok reasoning replay attribution', () => {
  it.each([
    ['grok-cli', 'grok-4.7', true],
    ['grok-cli', 'grok-4.6', false],
    ['openai', 'gpt-5', false]
  ] as const)('replays only to the source provider/model: %s %s', async (providerId, modelId, replay) => {
    const source = createModel()
    const first = await source.model.doGenerate({ prompt, providerOptions })
    expect(source.requests[0].reasoning).toEqual({ effort: 'high' })
    const content = first.content.flatMap((part) =>
      part.type === 'reasoning'
        ? [{ type: 'reasoning' as const, text: part.text, providerOptions: part.providerMetadata }]
        : []
    )
    // Persistence must preserve the opaque payload and its attribution together.
    const persisted = JSON.parse(JSON.stringify(content))
    const target = createModel(providerId, modelId)
    await target.model.doGenerate({
      prompt: [
        ...prompt,
        { role: 'assistant', content: [...persisted, { type: 'text', text: 'Hello' }] },
        { role: 'user', content: [{ type: 'text', text: 'Continue' }] }
      ],
      providerOptions
    })
    const encrypted = target.requests[0].input.filter((item: Record<string, unknown>) => item.type === 'reasoning')
    expect(encrypted).toEqual(replay ? [reasoning] : [])
    expect(target.requests[0].input.some((item: Record<string, unknown>) => item.role === 'assistant')).toBe(true)
  })

  it('keeps streamed encrypted-only reasoning with its model attribution', async () => {
    const source = createModel('grok-cli', 'grok-4.7', true)
    const result = await source.model.doStream({ prompt, providerOptions })
    const chunks: LanguageModelV4StreamPart[] = []
    for await (const chunk of result.stream) chunks.push(chunk)
    expect(chunks.find((part) => part.type === 'reasoning-end')).toMatchObject({
      providerMetadata: {
        openai: { reasoningEncryptedContent: 'opaque' },
        grokCli: { providerId: 'grok-cli', modelId: 'grok-4.7' }
      }
    })
  })

  it.each(['grok-cli', 'openai'])('handles untagged OpenAI reasoning when targeting %s', async (providerId) => {
    const { model, requests } = createModel(providerId)
    await model.doGenerate({
      prompt: [
        {
          role: 'assistant',
          content: [
            {
              type: 'reasoning',
              text: '',
              providerOptions: { openai: { itemId: 'rs_foreign', reasoningEncryptedContent: 'foreign' } }
            },
            { type: 'text', text: 'Previous answer' }
          ]
        },
        ...prompt
      ],
      providerOptions
    })
    expect(requests[0].input.some((item: Record<string, unknown>) => item.type === 'reasoning')).toBe(
      providerId === 'openai'
    )
  })
})
