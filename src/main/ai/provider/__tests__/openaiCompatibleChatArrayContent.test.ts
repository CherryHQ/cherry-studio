import { OpenAICompatibleChatLanguageModel } from '@ai-sdk/openai-compatible'
import type { LanguageModelV3CallOptions, LanguageModelV3StreamPart } from '@ai-sdk/provider'
import { describe, expect, it } from 'vitest'

// Guards patches/@ai-sdk__openai-compatible@2.0.72.patch (CherryHQ/cherry-studio#20460).
// Volcano Ark sends assistant `content` as string|array|null on thinking+tool turns, but the
// upstream chat schemas require `content: z.string().nullish()` — a valid HTTP 200 carrying
// `reasoning_content` + `tool_calls` then fails validation and the tool call is discarded.
// The patch widens both `content` schemas to accept arrays, folding only string items and
// string `text`/`refusal` fields to text (empty → null); any other shape throws, failing
// validation loudly ("Invalid JSON response" / mid-stream `error` part). If the SDK upgrade
// drops the patch, this test fails loudly.
// NOTE (out of scope): non-streaming `function.name`/`function.arguments` stay upstream-strict.
const PROMPT: LanguageModelV3CallOptions['prompt'] = [
  { role: 'user', content: [{ type: 'text', text: 'weather in Beijing?' }] }
]

const MODEL = 'doubao-seed-1-6'
const REASONING = 'Let me check the weather in Beijing.'
const TOOL_ARGS = '{"city":"Beijing"}'

function toolCall() {
  return { id: 'call_volcano_1', type: 'function', function: { name: 'get_weather', arguments: TOOL_ARGS } }
}

function chatBody(content: unknown) {
  return {
    id: 'chatcmpl-volcano',
    object: 'chat.completion',
    created: 1757846400,
    model: MODEL,
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content, reasoning_content: REASONING, tool_calls: [toolCall()] },
        finish_reason: 'tool_calls'
      }
    ]
  }
}

function jsonResponse(payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  })
}

function chatModel(respond: () => Response) {
  return new OpenAICompatibleChatLanguageModel(MODEL, {
    provider: 'volcano',
    url: () => 'https://ark.cn-beijing.volces.com/api/v3/chat/completions',
    headers: () => ({}),
    fetch: async () => respond()
  })
}

function sseResponse(chunks: Array<Record<string, unknown>>) {
  const body = chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join('') + 'data: [DONE]\n\n'
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
}

function sseChunk(delta: Record<string, unknown>, finishReason: string | null = null) {
  return {
    id: 'chatcmpl-volcano',
    object: 'chat.completion.chunk',
    created: 1757846400,
    model: MODEL,
    choices: [{ index: 0, delta, finish_reason: finishReason }]
  }
}

async function collectParts(stream: ReadableStream<LanguageModelV3StreamPart>) {
  const parts: LanguageModelV3StreamPart[] = []
  const reader = stream.getReader()
  while (true) {
    const { done, value } = await reader.read()
    if (done) return parts
    parts.push(value)
  }
}

describe('patched @ai-sdk/openai-compatible chat schema tolerates Volcano array content', () => {
  it('non-streaming content:[] keeps reasoning and the tool call', async () => {
    const result = await chatModel(() => jsonResponse(chatBody([]))).doGenerate({ prompt: PROMPT })

    expect(result.content).toContainEqual({ type: 'reasoning', text: REASONING })
    expect(result.content).toContainEqual(
      expect.objectContaining({ type: 'tool-call', toolName: 'get_weather', input: TOOL_ARGS })
    )
    expect(result.content.filter((p) => p.type === 'text')).toEqual([])
  })

  it('non-streaming parts-array content preserves the text alongside reasoning and tools', async () => {
    const result = await chatModel(() => jsonResponse(chatBody([{ type: 'text', text: 'hi' }]))).doGenerate({
      prompt: PROMPT
    })

    expect(result.content).toContainEqual({ type: 'text', text: 'hi' })
    expect(result.content).toContainEqual({ type: 'reasoning', text: REASONING })
    expect(result.content).toContainEqual(
      expect.objectContaining({ type: 'tool-call', toolName: 'get_weather', input: TOOL_ARGS })
    )
  })

  it('non-streaming content:null control keeps reasoning and the tool call', async () => {
    const result = await chatModel(() => jsonResponse(chatBody(null))).doGenerate({ prompt: PROMPT })

    expect(result.content).toContainEqual({ type: 'reasoning', text: REASONING })
    expect(result.content).toContainEqual(
      expect.objectContaining({ type: 'tool-call', toolName: 'get_weather', input: TOOL_ARGS })
    )
  })

  it('streaming delta.content:[] completes with reasoning and tool-call parts and no error part', async () => {
    const { stream } = await chatModel(() =>
      sseResponse([
        sseChunk({ role: 'assistant', content: [], reasoning_content: REASONING }),
        sseChunk({
          tool_calls: [{ index: 0, id: 'call_volcano_1', function: { name: 'get_weather', arguments: TOOL_ARGS } }]
        }),
        sseChunk({}, 'tool_calls')
      ])
    ).doStream({ prompt: PROMPT })

    const parts = await collectParts(stream)

    expect(parts.filter((p) => p.type === 'error')).toEqual([])
    expect(
      parts
        .filter((p) => p.type === 'reasoning-delta')
        .map((p) => p.delta)
        .join('')
    ).toBe(REASONING)
    expect(parts).toContainEqual(expect.objectContaining({ type: 'tool-input-start', toolName: 'get_weather' }))
    expect(
      parts
        .filter((p) => p.type === 'tool-input-delta')
        .map((p) => p.delta)
        .join('')
    ).toBe(TOOL_ARGS)
  })

  it('streaming parts-array delta preserves the text alongside reasoning and tools', async () => {
    const { stream } = await chatModel(() =>
      sseResponse([
        sseChunk({
          role: 'assistant',
          content: [{ type: 'text', text: 'hi' }],
          reasoning_content: REASONING
        }),
        sseChunk({
          tool_calls: [{ index: 0, id: 'call_volcano_1', function: { name: 'get_weather', arguments: TOOL_ARGS } }]
        }),
        sseChunk({}, 'tool_calls')
      ])
    ).doStream({ prompt: PROMPT })

    const parts = await collectParts(stream)

    expect(parts.filter((p) => p.type === 'error')).toEqual([])
    expect(
      parts
        .filter((p) => p.type === 'text-delta')
        .map((p) => p.delta)
        .join('')
    ).toBe('hi')
    expect(
      parts
        .filter((p) => p.type === 'reasoning-delta')
        .map((p) => p.delta)
        .join('')
    ).toBe(REASONING)
    expect(
      parts
        .filter((p) => p.type === 'tool-input-delta')
        .map((p) => p.delta)
        .join('')
    ).toBe(TOOL_ARGS)
  })

  it('streaming string-content control completes with reasoning and tool-call parts', async () => {
    const { stream } = await chatModel(() =>
      sseResponse([
        sseChunk({ role: 'assistant', content: '', reasoning_content: REASONING }),
        sseChunk({
          tool_calls: [{ index: 0, id: 'call_volcano_1', function: { name: 'get_weather', arguments: TOOL_ARGS } }]
        }),
        sseChunk({}, 'tool_calls')
      ])
    ).doStream({ prompt: PROMPT })

    const parts = await collectParts(stream)

    expect(parts.filter((p) => p.type === 'error')).toEqual([])
    expect(
      parts
        .filter((p) => p.type === 'reasoning-delta')
        .map((p) => p.delta)
        .join('')
    ).toBe(REASONING)
    expect(
      parts
        .filter((p) => p.type === 'tool-input-delta')
        .map((p) => p.delta)
        .join('')
    ).toBe(TOOL_ARGS)
  })

  it('non-streaming unknown part shape rejects loudly instead of dropping data', async () => {
    await expect(
      chatModel(() =>
        jsonResponse(chatBody([{ type: 'image_url', image_url: { url: 'https://x/y.png' } }]))
      ).doGenerate({ prompt: PROMPT })
    ).rejects.toThrow(/Invalid JSON response/)
  })

  it('non-streaming refusal part surfaces its text alongside reasoning and tools', async () => {
    const result = await chatModel(() => jsonResponse(chatBody([{ type: 'refusal', refusal: 'no' }]))).doGenerate({
      prompt: PROMPT
    })

    expect(result.content).toContainEqual({ type: 'text', text: 'no' })
    expect(result.content).toContainEqual({ type: 'reasoning', text: REASONING })
    expect(result.content).toContainEqual(
      expect.objectContaining({ type: 'tool-call', toolName: 'get_weather', input: TOOL_ARGS })
    )
  })

  it('streaming unknown part shape surfaces an error part and no tool-call parts', async () => {
    // The malformed chunk carries tool_calls too: failing the whole chunk loudly
    // (instead of salvaging the tool call while silently dropping the content).
    const { stream } = await chatModel(() =>
      sseResponse([
        sseChunk({
          role: 'assistant',
          content: [{ foo: 1 }],
          reasoning_content: REASONING,
          tool_calls: [{ index: 0, id: 'call_volcano_1', function: { name: 'get_weather', arguments: TOOL_ARGS } }]
        }),
        sseChunk({}, 'tool_calls')
      ])
    ).doStream({ prompt: PROMPT })

    const parts = await collectParts(stream)

    expect(parts.filter((p) => p.type === 'error')).not.toEqual([])
    expect(parts.filter((p) => p.type.startsWith('tool'))).toEqual([])
  })
})
