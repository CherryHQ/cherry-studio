import { normalizeContext } from '@earendil-works/pi-ai'
import type { Api, AssistantMessage, Message, Model } from '@earendil-works/pi-ai'
import { streamSimple } from '@earendil-works/pi-ai/api/google-generative-ai'
import type { ProviderConfig } from '@earendil-works/pi-coding-agent'
import { describe, expect, it } from 'vitest'

import { withGoogleReplayIdentity } from './piGoogleReplay'

type PiStreamSimple = NonNullable<ProviderConfig['streamSimple']>
type Part = { functionCall?: { id: string; name: string; args: unknown }; text?: string; thoughtSignature?: string }
type RequestBody = { contents: Array<{ role: string; parts: Part[] }> }

const PROVIDER = 'google-fixture'
const SESSION = '00000000-0000-4000-8000-000000000001'
const FIRST_GENERATION = '00000000-0000-4000-8000-000000000002'
const NEXT_GENERATION = '00000000-0000-4000-8000-000000000003'
const SIGNATURE = Buffer.from('fixture-tool-signature').toString('base64')
const NEXT_SIGNATURE = Buffer.from('fixture-next-tool-signature').toString('base64')
const TEXT_SIGNATURE = Buffer.from('fixture-text-signature').toString('base64')

function model(generation = FIRST_GENERATION): Model<Api> {
  return {
    id: 'gemini-4-argon',
    name: 'Gemini fixture',
    api: `cherry-${SESSION}-${generation}-google-generative-ai`,
    provider: `${PROVIDER}:${SESSION}:${generation}`,
    baseUrl: 'https://gemini.test/v1beta',
    reasoning: false,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 32_000,
    maxTokens: 1_000
  }
}

function fixture(responses: Part[][]) {
  const requests: RequestBody[] = []
  const fetch: typeof globalThis.fetch = async (_input, init) => {
    const parts = responses[requests.length]
    requests.push(JSON.parse(String(init?.body)))
    if (!parts) throw new Error('Unexpected fixture request')
    const chunk = {
      candidates: [{ content: { role: 'model', parts }, finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 }
    }
    return new Response(`data: ${JSON.stringify(chunk)}\n\n`, {
      headers: { 'Content-Type': 'text/event-stream' }
    })
  }
  const nativeStream: PiStreamSimple = (target, context, options) =>
    streamSimple(target as Model<'google-generative-ai'>, context, { ...options, fetch })
  return { requests, stream: withGoogleReplayIdentity(nativeStream, PROVIDER) }
}

function call(id: string, signature?: string): Part {
  return {
    functionCall: { id, name: 'read', args: { path: `${id}.txt` } },
    ...(signature ? { thoughtSignature: signature } : {})
  }
}

function appendTools(history: Message[], assistant: AssistantMessage): void {
  history.push(assistant)
  for (const block of assistant.content) {
    if (block.type !== 'toolCall') continue
    history.push({
      role: 'toolResult',
      toolCallId: block.id,
      toolName: block.name,
      content: [{ type: 'text', text: 'fixture content' }],
      isError: false,
      timestamp: 3
    })
  }
}

function invoke(stream: PiStreamSimple, target: Model<Api>, messages: Message[]) {
  return stream(target, normalizeContext({ messages }), {
    apiKey: 'fixture-only',
    maxRetries: 0,
    timeoutMs: 2_000
  }).result()
}

function replayedCalls(request: RequestBody) {
  return request.contents.flatMap((content) => content.parts.filter((part) => part.functionCall))
}

describe('Google replay through Cherry connection namespaces (#22810)', () => {
  it('preserves real signatures across parallel and sequential tool steps', async () => {
    const { stream, requests } = fixture([
      [call('a', SIGNATURE), call('b')],
      [call('c', NEXT_SIGNATURE)],
      [{ text: 'complete', thoughtSignature: TEXT_SIGNATURE }],
      [{ text: 'continued' }]
    ])
    const target = model()
    const history: Message[] = [{ role: 'user', content: 'Read fixtures.', timestamp: 1 }]
    appendTools(history, await invoke(stream, target, history))
    appendTools(history, await invoke(stream, target, history))
    history.push(await invoke(stream, target, history))
    history.push({ role: 'user', content: 'Continue.', timestamp: 5 })
    const result = await invoke(stream, target, history)

    expect(result.stopReason).toBe('stop')
    expect(replayedCalls(requests[1])).toEqual([call('a', SIGNATURE), call('b')])
    expect(replayedCalls(requests[2])).toEqual([call('a', SIGNATURE), call('b'), call('c', NEXT_SIGNATURE)])
    expect(requests[3].contents.flatMap((content) => content.parts)).toContainEqual({
      text: 'complete',
      thoughtSignature: TEXT_SIGNATURE
    })
    expect(target.api).toContain('cherry-')
  })

  it('replays serialized history after a new connection generation without rewriting stored messages', async () => {
    const { stream, requests } = fixture([[call('a', SIGNATURE)], [{ text: 'resumed' }]])
    const history: Message[] = [{ role: 'user', content: 'Read fixture.', timestamp: 1 }]
    appendTools(history, await invoke(stream, model(), history))
    const stored = JSON.stringify(history)
    const restored: Message[] = JSON.parse(stored)
    const resumed = await invoke(stream, model(NEXT_GENERATION), restored)

    expect(resumed.stopReason).toBe('stop')
    expect(replayedCalls(requests[1])).toEqual([call('a', SIGNATURE)])
    expect(JSON.stringify(restored)).toBe(stored)
    expect(resumed.provider).toBe(model(NEXT_GENERATION).provider)
  })

  it.each([
    { provider: `another-provider:${SESSION}:${FIRST_GENERATION}` },
    { provider: `${PROVIDER}-other:${SESSION}:${FIRST_GENERATION}` },
    { provider: `${PROVIDER}:not-a-session:not-a-generation` },
    { provider: `${PROVIDER}:${SESSION}:${FIRST_GENERATION}:extra` },
    { model: 'gemini-3.8-flash' },
    { api: 'openai-completions' }
  ])('does not relabel foreign history: %j', async (foreign) => {
    const { stream, requests } = fixture([[call('a', SIGNATURE)], [{ text: 'complete' }]])
    const history: Message[] = [{ role: 'user', content: 'Read fixture.', timestamp: 1 }]
    const original = await invoke(stream, model(), history)
    appendTools(history, { ...original, ...foreign })
    await invoke(stream, model(NEXT_GENERATION), history)

    expect(replayedCalls(requests[1])).toEqual([call('a')])
  })

  it('does not fabricate signatures for unsigned historical calls', async () => {
    const { stream, requests } = fixture([[call('a')], [{ text: 'complete' }]])
    const history: Message[] = [{ role: 'user', content: 'Read fixture.', timestamp: 1 }]
    appendTools(history, await invoke(stream, model(), history))
    await invoke(stream, model(NEXT_GENERATION), history)

    expect(replayedCalls(requests[1])).toEqual([call('a')])
  })
})
