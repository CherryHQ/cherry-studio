import type { LanguageModelV3, LanguageModelV3CallOptions } from '@ai-sdk/provider'
import { describe, expect, it } from 'vitest'

import { applyMaxMessagesWindow } from '@main/ai/messages/maxMessagesWindow'

import { createGoogleInteractionsProvider } from '../googleInteractionsProvider'

type Prompt = LanguageModelV3CallOptions['prompt']
const modelId = 'gemini-4-argon'
const prompt: Prompt = [{ role: 'user', content: [{ type: 'text', text: 'Reply OK.' }] }]
const baseURL = 'https://gemini.example.test/v1beta'
const completed = (text = 'OK') => ({
  id: 'interaction-1',
  status: 'completed',
  steps: [{ type: 'model_output', content: [{ type: 'text', text }] }]
})

function setup(responses: Response[], id = modelId) {
  const requests: { url: string; body: Record<string, unknown>; headers: Headers }[] = []
  const provider = createGoogleInteractionsProvider({
    apiKey: 'test-key',
    baseURL,
    headers: { 'x-custom-header': 'test-value' },
    fetch: async (url, init) => {
      requests.push({ url: String(url), body: JSON.parse(String(init?.body)), headers: new Headers(init?.headers) })
      const response = responses.shift()
      if (!response) throw new Error('Unexpected request')
      return response
    }
  })
  return { requests, model: provider.languageModel(id) }
}

function streamResponse(text: string) {
  const events = [
    { event_type: 'interaction.created', interaction: { id: 'interaction-1', status: 'in_progress' } },
    { event_type: 'step.start', index: 0, step: { type: 'model_output', id: 'step-1', content: [] } },
    { event_type: 'step.delta', index: 0, delta: { type: 'text', text } },
    { event_type: 'step.stop', index: 0 },
    { event_type: 'interaction.completed', interaction: completed(text) }
  ]
  return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''), {
    headers: { 'content-type': 'text/event-stream' }
  })
}

async function generate(model: LanguageModelV3, history: Prompt, mode: 'generate' | 'stream') {
  if (mode === 'generate') {
    const result = await model.doGenerate({ prompt: history })
    return result.content
      .filter((part) => part.type === 'text')
      .map((part) => part.text)
      .join('')
  }
  const result = await model.doStream({ prompt: history })
  let text = ''
  for await (const chunk of result.stream) {
    expect(chunk.type).not.toBe('error')
    if (chunk.type === 'text-delta') text += chunk.delta
  }
  return text
}

function inputText(body: Record<string, unknown>) {
  return (body.input as { content: { text: string }[] }[]).flatMap((step) => step.content.map((part) => part.text))
}

describe('client-owned Google Interactions', () => {
  it.each(['generate', 'stream'] as const)(
    'sends full client history through %s without resuming server state',
    async (mode) => {
      const { requests, model } = setup([mode === 'generate' ? Response.json(completed()) : streamResponse('OK')])
      const history: Prompt = [
        { role: 'system', content: 'Be concise.' },
        { role: 'user', content: [{ type: 'text', text: 'Edited request.' }] },
        {
          role: 'assistant',
          content: [{ type: 'text', text: 'Edited answer.', providerOptions: { google: { interactionId: 'old' } } }]
        },
        { role: 'user', content: [{ type: 'text', text: 'Continue.' }] }
      ]
      expect(await generate(model, history, mode)).toBe('OK')
      expect(requests[0].url).toBe(`${baseURL}/interactions`)
      expect(requests[0].headers.get('x-goog-api-key')).toBe('test-key')
      expect(requests[0].headers.get('x-custom-header')).toBe('test-value')
      expect(requests[0].body).toMatchObject({
        model: modelId,
        store: false,
        background: false,
        system_instruction: 'Be concise.'
      })
      expect(requests[0].body).not.toHaveProperty('agent')
      expect(requests[0].body).not.toHaveProperty('environment')
      expect(requests[0].body).not.toHaveProperty('previous_interaction_id')
      expect(inputText(requests[0].body)).toEqual(['Edited request.', 'Edited answer.', 'Continue.'])
    }
  )

  it('does not allow provider options to bypass client-owned history', async () => {
    const { requests, model } = setup([Response.json(completed())])
    await model.doGenerate({
      prompt,
      providerOptions: { google: { previousInteractionId: 'old', store: true, background: true } }
    })
    expect(requests[0].body).toMatchObject({ store: false, background: false })
    expect(requests[0].body).not.toHaveProperty('previous_interaction_id')
    expect(inputText(requests[0].body)).toEqual(['Reply OK.'])
  })

  it.each(['generate', 'stream'] as const)('honors the moving context window through %s', async (mode) => {
    const { requests, model } = setup(
      [1, 2, 3].map((turn) => (mode === 'generate' ? Response.json(completed(`A${turn}`)) : streamResponse(`A${turn}`)))
    )
    const history: Prompt = []
    for (let turn = 1; turn <= 3; turn++) {
      history.push({ role: 'user', content: [{ type: 'text', text: `U${turn}` }] })
      const text = await generate(model, applyMaxMessagesWindow(history, 2), mode)
      history.push({
        role: 'assistant',
        content: [{ type: 'text', text, providerOptions: { google: { interactionId: 'old' } } }]
      })
    }
    expect(inputText(requests[2].body)).toEqual(['U2', 'A2', 'U3'])
    expect(requests[2].body).not.toHaveProperty('previous_interaction_id')
  })

  it.each(['gemini-omni-1.1-flash', 'gemini-omni-flash-preview'])('returns the video from %s as a file', async (id) => {
    const { requests, model } = setup(
      [
        Response.json({
          id: 'video-1',
          status: 'completed',
          steps: [{ type: 'model_output', content: [{ type: 'video', mime_type: 'video/mp4', data: 'dmlkZW8=' }] }]
        })
      ],
      id
    )
    const result = await model.doGenerate({
      prompt,
      providerOptions: { google: { responseFormat: [{ type: 'video', resolution: '360p', duration: '3s' }] } }
    })
    expect(requests[0].body).toMatchObject({
      model: id,
      store: false,
      response_format: [{ type: 'video', resolution: '360p', duration: '3s' }]
    })
    expect(requests[0].body).not.toHaveProperty('agent')
    expect(result.content).toContainEqual(
      expect.objectContaining({ type: 'file', mediaType: 'video/mp4', data: 'dmlkZW8=' })
    )
  })

  it('propagates API failures', async () => {
    const { model } = setup([
      Response.json({ error: { message: 'Quota exceeded', code: 429, status: 'RESOURCE_EXHAUSTED' } }, { status: 429 })
    ])
    await expect(model.doGenerate({ prompt })).rejects.toThrow('Quota exceeded')
  })
})
