import { createOpenAI } from '@ai-sdk/openai'
import { OpenAIResponsesLanguageModel } from '@ai-sdk/openai/internal'
import type { LanguageModelV3StreamPart } from '@ai-sdk/provider'
import { describe, expect, it } from 'vitest'

/**
 * Guards the `response.output_item.added` hunk in patches/@ai-sdk__openai@3.0.109.patch.
 *
 * Third-party Responses endpoints (Volcano Ark's Agent plan, #21083) emit the
 * tool-call item of `response.output_item.added` WITHOUT `arguments` — the field is
 * legitimately empty at that point and arrives later via
 * `response.function_call_arguments.delta`. Unpatched, the strict schema rejects the
 * event, `doStream` emits an `error` chunk, `tool-input-start` never fires, and the
 * stream terminates with `finishReason: 'error'`. In an agent session that kills the
 * task outright.
 *
 * The complement to this, `response.output_item.done`, keeps `arguments` required —
 * that event is where the assembled input is actually read, so relaxing it would let
 * real corruption through silently.
 */

/** Build a model whose Responses endpoint replays the given SSE events. */
function sseModel(events: unknown[]) {
  const body = `${events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('')}data: [DONE]\n\n`
  return createOpenAI({
    apiKey: 'sk-test',
    baseURL: 'https://example.com/v1',
    fetch: async () => new Response(body, { headers: { 'content-type': 'text/event-stream' } })
  }).responses('gpt-5.6')
}

/**
 * Same, through the `internal` bundle. Custom providers construct this entry's
 * Responses model directly, so a patch that only landed in `dist/index.*` would
 * leave the agent path broken.
 */
function internalSseModel(events: unknown[]) {
  const body = `${events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('')}data: [DONE]\n\n`
  return new OpenAIResponsesLanguageModel('gpt-5.6', {
    provider: 'openai.responses',
    url: () => 'https://example.com/v1/responses',
    headers: () => ({}),
    fetch: async () => new Response(body, { headers: { 'content-type': 'text/event-stream' } }),
    generateId: () => 'id'
  })
}

async function collect(stream: ReadableStream<LanguageModelV3StreamPart>) {
  const reader = stream.getReader()
  const chunks: LanguageModelV3StreamPart[] = []
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
  }
  return chunks
}

const prompt = [{ role: 'user' as const, content: [{ type: 'text' as const, text: 'list files' }] }]

describe('patched @ai-sdk/openai accepts output_item.added without arguments', () => {
  it('streams the tool call through when output_item.added omits arguments', async () => {
    const { stream } = await sseModel([
      { type: 'response.created', response: { id: 'resp_1', created_at: 1787598519, model: 'm' } },
      {
        type: 'response.output_item.added',
        output_index: 0,
        // exactly what Ark sends: call_id/name/type/id/status, no `arguments`
        item: { type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'Bash', status: 'in_progress' }
      },
      { type: 'response.function_call_arguments.delta', item_id: 'fc_1', output_index: 0, delta: '{"cmd":"ls"}' },
      {
        type: 'response.output_item.done',
        output_index: 0,
        item: {
          type: 'function_call',
          id: 'fc_1',
          call_id: 'call_1',
          name: 'Bash',
          arguments: '{"cmd":"ls"}',
          status: 'completed'
        }
      },
      { type: 'response.completed', response: { id: 'resp_1', created_at: 1787598519, model: 'm' } }
    ]).doStream({ prompt })

    const chunks = await collect(stream)

    expect(chunks.map((chunk) => chunk.type)).not.toContain('error')
    // the caller only ever pairs this call by call_id, so identity must survive
    expect(chunks).toContainEqual(expect.objectContaining({ type: 'tool-input-start', id: 'call_1', toolName: 'Bash' }))
    expect(chunks).toContainEqual(
      expect.objectContaining({ type: 'tool-call', toolCallId: 'call_1', toolName: 'Bash', input: '{"cmd":"ls"}' })
    )
    // finish 'error' is what aborted the session before the patch
    expect(chunks.find((chunk) => chunk.type === 'finish')).toMatchObject({
      finishReason: { unified: 'tool-calls' }
    })
  })

  it('streams the tool call through the internal bundle custom providers use', async () => {
    const { stream } = await internalSseModel([
      {
        type: 'response.output_item.added',
        output_index: 0,
        item: { type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'Bash', status: 'in_progress' }
      },
      { type: 'response.function_call_arguments.delta', item_id: 'fc_1', output_index: 0, delta: '{"cmd":"ls"}' },
      {
        type: 'response.output_item.done',
        output_index: 0,
        item: {
          type: 'function_call',
          id: 'fc_1',
          call_id: 'call_1',
          name: 'Bash',
          arguments: '{"cmd":"ls"}',
          status: 'completed'
        }
      }
    ]).doStream({ prompt })

    const chunks = await collect(stream)

    expect(chunks.map((chunk) => chunk.type)).not.toContain('error')
    expect(chunks).toContainEqual(
      expect.objectContaining({ type: 'tool-call', toolCallId: 'call_1', toolName: 'Bash', input: '{"cmd":"ls"}' })
    )
  })

  it('rejects an explicit null arguments, which no observed endpoint sends', async () => {
    const { stream } = await sseModel([
      {
        type: 'response.output_item.added',
        output_index: 0,
        // `.optional()` not `.nullish()`: the field is omitted, never sent as null
        item: { type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'Bash', arguments: null }
      }
    ]).doStream({ prompt })

    const chunks = await collect(stream)

    expect(chunks.map((chunk) => chunk.type)).toContain('error')
    expect(chunks.map((chunk) => chunk.type)).not.toContain('tool-input-start')
  })

  it('preserves partial output already emitted before a later event still fails validation', async () => {
    const { stream } = await sseModel([
      { type: 'response.created', response: { id: 'resp_1', created_at: 1787598519, model: 'm' } },
      { type: 'response.output_item.added', output_index: 0, item: { type: 'message', id: 'msg_1' } },
      { type: 'response.output_text.delta', item_id: 'msg_1', output_index: 0, content_index: 0, delta: 'partial' },
      // not covered by this patch: `response.completed` requires a response object
      { type: 'response.completed' }
    ]).doStream({ prompt })

    const chunks = await collect(stream)

    expect(chunks.filter((chunk) => chunk.type === 'error')).toHaveLength(1)
    expect(chunks).toContainEqual(expect.objectContaining({ type: 'text-delta', id: 'msg_1', delta: 'partial' }))
  })
})
