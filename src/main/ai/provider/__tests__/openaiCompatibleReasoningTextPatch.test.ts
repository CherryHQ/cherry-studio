import type { LanguageModelV3CallOptions, LanguageModelV3StreamPart } from '@ai-sdk/provider'
import { createGitHubCopilotOpenAICompatible } from '@opeoginni/github-copilot-openai-compatible'
import { describe, expect, it } from 'vitest'

const prompt: LanguageModelV3CallOptions['prompt'] = [{ role: 'user', content: [{ type: 'text', text: 'Hello' }] }]

function sse(events: unknown[]): string {
  return `${events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('')}data: [DONE]\n\n`
}

function chunk(delta: Record<string, unknown>, finish_reason: string | null = null) {
  return { choices: [{ delta, finish_reason }] }
}

async function readStream(body: string) {
  let requestBody: Record<string, unknown> = {}
  const model = createGitHubCopilotOpenAICompatible({
    apiKey: 'copilot-test-token',
    fetch: async (_input, init) => {
      requestBody = JSON.parse(init?.body as string)
      return new Response(body, { headers: { 'content-type': 'text/event-stream' } })
    }
  }).languageModel('claude-sonnet-4')

  const { stream } = await model.doStream({ prompt })
  const parts: LanguageModelV3StreamPart[] = []
  for await (const part of stream) parts.push(part)
  return { parts, requestBody }
}

async function readGenerate(message: Record<string, unknown>) {
  const model = createGitHubCopilotOpenAICompatible({
    apiKey: 'copilot-test-token',
    fetch: async () =>
      Response.json({
        id: 'chatcmpl-1',
        choices: [{ message: { role: 'assistant', ...message }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
      })
  }).languageModel('claude-sonnet-4')
  return model.doGenerate({ prompt })
}

// Guards patches/@ai-sdk__openai-compatible@2.0.72.patch: Copilot Claude models
// put the readable chain in `reasoning_text` (not `reasoning_content` / `reasoning`).
describe('OpenAI-compatible Copilot reasoning_text patch', () => {
  it('maps streaming reasoning_text into reasoning parts before text', async () => {
    const { parts, requestBody } = await readStream(
      sse([
        chunk({ reasoning_text: 'think-' }),
        chunk({ reasoning_text: 'ing' }),
        chunk({ content: 'answer' }),
        chunk({}, 'stop')
      ])
    )

    expect(parts).toContainEqual({ type: 'reasoning-start', id: 'reasoning-0' })
    expect(
      parts
        .filter((part) => part.type === 'reasoning-delta' && part.id === 'reasoning-0')
        .map((part) => (part.type === 'reasoning-delta' ? part.delta : ''))
        .join('')
    ).toBe('think-ing')

    const reasoningEnd = parts.findIndex((part) => part.type === 'reasoning-end' && part.id === 'reasoning-0')
    const textStart = parts.findIndex((part) => part.type === 'text-start')
    expect(reasoningEnd).toBeGreaterThanOrEqual(0)
    expect(textStart).toBeGreaterThan(reasoningEnd)
    expect(parts).toContainEqual({ type: 'text-delta', id: 'txt-0', delta: 'answer' })

    expect(Object.keys(requestBody).toSorted()).toEqual(['messages', 'model', 'stream'])
    expect(requestBody).toEqual({
      model: 'claude-sonnet-4',
      messages: [{ role: 'user', content: 'Hello' }],
      stream: true
    })
  })

  it('prefers reasoning_content over reasoning_text and keeps gpt-oss reasoning', async () => {
    const contentWins = await readStream(
      sse([chunk({ reasoning_content: 'from-content', reasoning_text: 'from-text' }), chunk({}, 'stop')])
    )
    expect(
      contentWins.parts
        .filter((part) => part.type === 'reasoning-delta')
        .map((part) => (part.type === 'reasoning-delta' ? part.delta : ''))
        .join('')
    ).toBe('from-content')

    const gptOss = await readStream(sse([chunk({ reasoning: 'from-reasoning' }), chunk({}, 'stop')]))
    expect(
      gptOss.parts
        .filter((part) => part.type === 'reasoning-delta')
        .map((part) => (part.type === 'reasoning-delta' ? part.delta : ''))
        .join('')
    ).toBe('from-reasoning')
  })

  it('emits no reasoning parts when the stream has no reasoning fields', async () => {
    const { parts } = await readStream(sse([chunk({ content: 'plain' }), chunk({}, 'stop')]))
    expect(parts.filter((part) => part.type.startsWith('reasoning-'))).toEqual([])
    expect(parts).toContainEqual({ type: 'text-delta', id: 'txt-0', delta: 'plain' })
  })

  it('maps non-streaming reasoning_text and prefers reasoning_content', async () => {
    const fromText = await readGenerate({ content: 'answer', reasoning_text: 'thought' })
    expect(fromText.content).toContainEqual({ type: 'reasoning', text: 'thought' })
    expect(fromText.content).toContainEqual({ type: 'text', text: 'answer' })

    const contentWins = await readGenerate({
      content: null,
      reasoning_content: 'from-content',
      reasoning_text: 'from-text'
    })
    expect(contentWins.content).toContainEqual({ type: 'reasoning', text: 'from-content' })
    expect(contentWins.content).not.toContainEqual({ type: 'reasoning', text: 'from-text' })
  })
})
