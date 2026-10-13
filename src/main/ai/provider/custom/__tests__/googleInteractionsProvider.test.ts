import type { LanguageModelV3CallOptions, LanguageModelV3StreamPart } from '@ai-sdk/provider'
import { describe, expect, it } from 'vitest'

import { createGoogleInteractionsProvider } from '../googleInteractionsProvider'

const agent = 'antigravity-preview-09-2026'
const baseURL = 'https://gemini.example.test/v1beta'
const prompt: LanguageModelV3CallOptions['prompt'] = [
  { role: 'user', content: [{ type: 'text', text: 'Create a file.' }] }
]
const completed = {
  id: 'interaction-1',
  environment_id: 'environment-1',
  status: 'completed',
  steps: [{ type: 'model_output', content: [{ type: 'text', text: 'Created file.' }] }]
}

function setup(responses: Response[]) {
  const requests: { url: string; body: Record<string, unknown>; headers: Headers; signal?: AbortSignal | null }[] = []
  const provider = createGoogleInteractionsProvider({
    apiKey: 'test-key',
    baseURL,
    headers: { 'x-custom-header': 'test-value' },
    fetch: async (url, init) => {
      requests.push({
        url: String(url),
        body: JSON.parse(String(init?.body)),
        headers: new Headers(init?.headers),
        signal: init?.signal
      })
      const response = responses.shift()
      if (!response) throw new Error('Unexpected request')
      return response
    }
  })
  return { requests, provider, model: provider.languageModel(agent) }
}

function jsonResponse(body = completed) {
  return Response.json(body)
}

describe('Antigravity Interactions transport', () => {
  it('uses the agent endpoint, provisions a sandbox, and returns the text with resumable state', async () => {
    const { requests, model } = setup([jsonResponse()])
    const signal = new AbortController().signal
    const result = await model.doGenerate({ prompt, abortSignal: signal })

    expect(requests[0].url).toBe(`${baseURL}/interactions`)
    expect(requests[0].body).toMatchObject({ agent, environment: 'remote' })
    expect(requests[0].body).not.toHaveProperty('model')
    expect(requests[0].headers.get('x-goog-api-key')).toBe('test-key')
    expect(requests[0].headers.get('x-custom-header')).toBe('test-value')
    expect(requests[0].signal).toBe(signal)
    expect(result.content).toContainEqual({
      type: 'text',
      text: 'Created file.',
      providerMetadata: {
        google: {
          interactionId: 'interaction-1',
          environmentId: 'environment-1',
          agentModelId: agent,
          agentBaseURL: baseURL
        }
      }
    })
    expect(model.supportedUrls).toEqual({})
  })

  it('resumes both conversation and sandbox using persisted assistant metadata without replaying old input', async () => {
    const { requests, model } = setup([jsonResponse(), jsonResponse()])
    const first = await model.doGenerate({ prompt })
    const text = first.content.find((part) => part.type === 'text')!
    const nextPrompt: LanguageModelV3CallOptions['prompt'] = [
      ...prompt,
      { role: 'assistant', content: [{ type: 'text', text: 'Created file.', providerOptions: text.providerMetadata }] },
      { role: 'user', content: [{ type: 'text', text: 'Edit that file.' }] }
    ]
    await model.doGenerate({ prompt: nextPrompt })

    expect(requests[1].body).toMatchObject({ previous_interaction_id: 'interaction-1', environment: 'environment-1' })
    expect(JSON.stringify(requests[1].body.input)).toContain('Edit that file.')
    expect(JSON.stringify(requests[1].body.input)).not.toContain('Create a file.')
  })

  it('does not resume an interaction belonging to another host or model', async () => {
    const { requests, model } = setup([jsonResponse()])
    await model.doGenerate({
      prompt: [
        {
          role: 'assistant',
          content: [
            {
              type: 'text',
              text: 'Hello',
              providerOptions: {
                google: {
                  interactionId: 'other-interaction',
                  environmentId: 'other-environment',
                  agentModelId: agent,
                  agentBaseURL: 'https://other.example.test/v1beta'
                }
              }
            }
          ]
        },
        ...prompt
      ]
    })
    expect(requests[0].body.environment).toBe('remote')
    expect(requests[0].body).not.toHaveProperty('previous_interaction_id')
  })

  it('streams text and retains sandbox state while hiding internal raw events', async () => {
    const events = [
      {
        event_type: 'interaction.created',
        interaction: { id: 'interaction-1', environment_id: 'environment-1', status: 'in_progress' }
      },
      { event_type: 'step.start', index: 0, step: { type: 'model_output', id: 'step-1', content: [] } },
      { event_type: 'step.delta', index: 0, delta: { type: 'text', text: 'Created file.' } },
      { event_type: 'step.stop', index: 0 },
      { event_type: 'interaction.completed', interaction: completed }
    ]
    const { requests, model } = setup([
      new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''), {
        headers: { 'content-type': 'text/event-stream' }
      })
    ])
    const result = await model.doStream({ prompt })
    const chunks: LanguageModelV3StreamPart[] = []
    for await (const chunk of result.stream) chunks.push(chunk)

    expect(requests[0].body).toMatchObject({ agent, environment: 'remote', stream: true })
    expect(chunks.filter((chunk) => chunk.type === 'error')).toEqual([])
    expect(chunks.filter((chunk) => chunk.type === 'raw')).toEqual([])
    expect(chunks).toContainEqual(expect.objectContaining({ type: 'text-delta', delta: 'Created file.' }))
    expect(chunks).toContainEqual(
      expect.objectContaining({
        type: 'text-end',
        providerMetadata: {
          google: {
            interactionId: 'interaction-1',
            environmentId: 'environment-1',
            agentModelId: agent,
            agentBaseURL: baseURL
          }
        }
      })
    )
  })

  it('propagates API failures instead of returning an empty successful answer', async () => {
    const { model } = setup([
      Response.json({ error: { message: 'Quota exceeded', code: 429, status: 'RESOURCE_EXHAUSTED' } }, { status: 429 })
    ])
    await expect(model.doGenerate({ prompt })).rejects.toThrow('Quota exceeded')
  })
})
