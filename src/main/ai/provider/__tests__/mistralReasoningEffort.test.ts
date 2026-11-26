import { createMistral } from '@ai-sdk/mistral'
import { describe, expect, it } from 'vitest'

describe('Mistral reasoning effort', () => {
  it.each([
    ['mistral-large-4-0', 'low'],
    ['mistral-large-4-0', 'medium'],
    ['mistral-large-4-0', 'high'],
    ['mistral-small-2603', 'none']
  ])('sends %s with reasoning_effort=%s and reads the response', async (modelId, reasoningEffort) => {
    const requests: unknown[] = []
    const content =
      reasoningEffort === 'none'
        ? '4'
        : [
            { type: 'thinking', thinking: [{ type: 'text', text: '2 + 2 equals 4.' }] },
            { type: 'text', text: '4' }
          ]
    const chunk = {
      id: 'completion-1',
      created: 1,
      model: modelId,
      choices: [{ index: 0, delta: { content }, finish_reason: 'stop' }]
    }
    const mistral = createMistral({
      apiKey: 'test',
      fetch: async (_input, init) => {
        requests.push(JSON.parse(String(init?.body)))
        return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, {
          headers: { 'content-type': 'text/event-stream' }
        })
      }
    })

    const { stream } = await mistral(modelId).doStream({
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'What is 2 + 2?' }] }],
      providerOptions: { mistral: { reasoningEffort } }
    })

    const parts = await Array.fromAsync(stream)
    expect(requests).toEqual([expect.objectContaining({ model: modelId, reasoning_effort: reasoningEffort })])
    expect(parts).toContainEqual(expect.objectContaining({ type: 'text-delta', delta: '4' }))
    expect(parts).toContainEqual(
      expect.objectContaining({ type: 'finish', finishReason: { unified: 'stop', raw: 'stop' } })
    )
    expect(parts.filter((part) => part.type === 'error')).toEqual([])
  })
})
