import type { FinishReason, UIMessageChunk } from 'ai'
import { describe, expect, it } from 'vitest'

import { GeminiSseFormatter } from '../formatters/GeminiSseFormatter'
import { AiSdkToGeminiSse, type GeminiGenerateContentResponse } from '../stream/AiSdkToGeminiSse'

const textDelta = (text: string, id = 'text_0'): UIMessageChunk => ({ type: 'text-delta', id, delta: text })
const reasoningDelta = (text: string, id = 'r_0'): UIMessageChunk => ({ type: 'reasoning-delta', id, delta: text })
const toolCall = (toolName: string, input: unknown): UIMessageChunk => ({
  type: 'tool-input-available',
  toolCallId: `${toolName}_0`,
  toolName,
  input
})
const finish = (finishReason: FinishReason = 'stop', usage?: Record<string, number>): UIMessageChunk => ({
  type: 'finish',
  finishReason,
  ...(usage ? { messageMetadata: usage } : {})
})

/** Drive the push API used by `proxyStream` and collect every emitted frame. */
function run(chunks: readonly UIMessageChunk[]): GeminiGenerateContentResponse[] {
  const adapter = new AiSdkToGeminiSse({ model: 'deepseek:deepseek-chat' })
  const frames: GeminiGenerateContentResponse[] = []
  for (const chunk of chunks) frames.push(...adapter.transformChunk(chunk))
  frames.push(...adapter.finalizeEvents())
  return frames
}

describe('AiSdkToGeminiSse (streaming)', () => {
  it('emits one delta frame per text-delta, then a terminal finishReason frame', () => {
    const frames = run([textDelta('Hello'), textDelta(' world'), finish('stop')])
    expect(frames.slice(0, 2)).toEqual([
      { candidates: [{ content: { role: 'model', parts: [{ text: 'Hello' }] }, index: 0 }] },
      { candidates: [{ content: { role: 'model', parts: [{ text: ' world' }] }, index: 0 }] }
    ])
    const last = frames[frames.length - 1]
    expect(last.candidates[0].finishReason).toBe('STOP')
    expect(last.candidates[0].content.parts).toEqual([])
    expect(last.modelVersion).toBe('deepseek:deepseek-chat')
  })

  it('marks reasoning deltas with thought: true', () => {
    const [frame] = run([reasoningDelta('thinking...')])
    expect(frame).toEqual({
      candidates: [{ content: { role: 'model', parts: [{ text: 'thinking...', thought: true }] }, index: 0 }]
    })
  })

  it('emits a functionCall part for a tool call', () => {
    const [frame] = run([toolCall('get_weather', { city: 'SF' })])
    expect(frame.candidates[0].content.parts).toEqual([{ functionCall: { name: 'get_weather', args: { city: 'SF' } } }])
  })

  it("emits the tool call's thoughtSignature from its provider metadata (Gemini 3 round-trip)", () => {
    const [frame] = run([
      {
        type: 'tool-input-available',
        toolCallId: 'search_0',
        toolName: 'search',
        input: { q: 'x' },
        providerMetadata: { google: { thoughtSignature: 'sig-abc' } }
      }
    ])
    expect(frame.candidates[0].content.parts).toEqual([
      { functionCall: { name: 'search', args: { q: 'x' } }, thoughtSignature: 'sig-abc' }
    ])
  })

  it('maps the AI SDK finish reason to the Gemini enum', () => {
    const frames = run([textDelta('x'), finish('length')])
    expect(frames[frames.length - 1].candidates[0].finishReason).toBe('MAX_TOKENS')
  })

  it('projects usage onto the terminal frame', () => {
    const frames = run([textDelta('x'), finish('stop', { promptTokens: 10, completionTokens: 20, thoughtsTokens: 5 })])
    expect(frames[frames.length - 1].usageMetadata).toEqual({
      promptTokenCount: 10,
      candidatesTokenCount: 20,
      totalTokenCount: 30,
      thoughtsTokenCount: 5
    })
  })

  it('throws on an error chunk so the stream surfaces a failure', () => {
    const adapter = new AiSdkToGeminiSse({ model: 'deepseek:deepseek-chat' })
    expect(() => adapter.transformChunk({ type: 'error', errorText: 'boom' })).toThrow('boom')
  })
})

describe('AiSdkToGeminiSse.buildNonStreamingResponse', () => {
  it('accumulates text (merged) and function calls into one candidate', () => {
    const adapter = new AiSdkToGeminiSse({ model: 'deepseek:deepseek-chat' })
    for (const chunk of [
      textDelta('Hel'),
      textDelta('lo'),
      toolCall('search', { q: 'x' }),
      finish('stop', { promptTokens: 3, completionTokens: 4 })
    ]) {
      adapter.transformChunk(chunk)
    }
    adapter.finalizeEvents()

    const response = adapter.buildNonStreamingResponse()
    expect(response.candidates[0].content.parts).toEqual([
      { text: 'Hello' },
      { functionCall: { name: 'search', args: { q: 'x' } } }
    ])
    expect(response.candidates[0].finishReason).toBe('STOP')
    expect(response.usageMetadata).toMatchObject({ promptTokenCount: 3, candidatesTokenCount: 4, totalTokenCount: 7 })
  })
})

describe('GeminiSseFormatter', () => {
  it('formats a frame as a Gemini SSE data line and emits no [DONE] sentinel', () => {
    const formatter = new GeminiSseFormatter()
    const frame: GeminiGenerateContentResponse = {
      candidates: [{ content: { role: 'model', parts: [{ text: 'hi' }] }, index: 0 }]
    }
    expect(formatter.formatEvent(frame)).toBe(`data: ${JSON.stringify(frame)}\n\n`)
    expect(formatter.formatDone()).toBe('')
  })
})
