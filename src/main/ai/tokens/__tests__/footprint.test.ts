import type { ModelMessage } from 'ai'
import { describe, expect, it } from 'vitest'

import {
  countToolDefs,
  countToolTokens,
  estimateModelMessagesFootprint,
  estimateModelMessagesSync,
  measureMedia
} from '../footprint'
import { mediaTokensFor } from '../profiles'
import type { TextTokenizer } from '../textTokenizer'

/** Deterministic tokenizer (1 token per char) so assertions are exact and tokenizer-agnostic. */
const fake: TextTokenizer = { id: 'fake', count: (t) => t.length }

const MESSAGE_OVERHEAD = 3
const TOOL_OVERHEAD = 10
const FILE_OVERHEAD = 5

/** A real 1×1 PNG, so `sharp` reads dimensions and the pixel formula runs. */
const PNG_1x1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

describe('estimateModelMessagesFootprint', () => {
  it('counts a plain-text tool_result output as TEXT (defensive path)', async () => {
    // The converter now emits structured image content, but a text output must still be
    // counted as text — a data-URL string here would ride as its full length.
    const dataUrl = `data:image/png;base64,${'A'.repeat(100_000)}`
    const messages: ModelMessage[] = [
      {
        role: 'tool',
        content: [{ type: 'tool-result', toolCallId: 't1', toolName: 'shot', output: { type: 'text', value: dataUrl } }]
      }
    ]
    expect(await estimateModelMessagesFootprint(messages, { dialect: 'anthropic', tokenizer: fake })).toBe(
      MESSAGE_OVERHEAD + TOOL_OVERHEAD + dataUrl.length
    )
  })

  it('counts a tool_result image-data item via the per-dialect pixel formula (dimensioned)', async () => {
    const messages: ModelMessage[] = [
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 't1',
            toolName: 'shot',
            output: { type: 'content', value: [{ type: 'image-data', data: PNG_1x1, mediaType: 'image/png' }] }
          }
        ]
      }
    ]
    // anthropic 1×1 image → ceil(1·1 / 750) = 1 token (NOT the base64 length).
    expect(await estimateModelMessagesFootprint(messages, { dialect: 'anthropic', tokenizer: fake })).toBe(
      MESSAGE_OVERHEAD + TOOL_OVERHEAD + 1
    )
  })

  it('counts a surviving top-level vision image with the per-dialect fallback when dims are unreadable', async () => {
    // Non-image bytes → sharp fails → the per-dialect constant, NOT the base64 length.
    const messages: ModelMessage[] = [
      { role: 'user', content: [{ type: 'image', image: 'A'.repeat(100_000), mediaType: 'image/png' }] }
    ]
    expect(await estimateModelMessagesFootprint(messages, { dialect: 'anthropic', tokenizer: fake })).toBe(
      MESSAGE_OVERHEAD + 1590
    )
    expect(await estimateModelMessagesFootprint(messages, { dialect: 'google', tokenizer: fake })).toBe(
      MESSAGE_OVERHEAD + 258
    )
  })

  it('treats an image file part as an image but a pdf file part as framing + filename', async () => {
    const image: ModelMessage[] = [{ role: 'user', content: [{ type: 'file', data: 'x', mediaType: 'image/jpeg' }] }]
    expect(await estimateModelMessagesFootprint(image, { dialect: 'openai', tokenizer: fake })).toBe(
      MESSAGE_OVERHEAD + 765
    )

    const pdf: ModelMessage[] = [
      { role: 'user', content: [{ type: 'file', data: 'x', mediaType: 'application/pdf', filename: 'a.pdf' }] }
    ]
    expect(await estimateModelMessagesFootprint(pdf, { dialect: 'openai', tokenizer: fake })).toBe(
      MESSAGE_OVERHEAD + FILE_OVERHEAD + 'a.pdf'.length
    )
  })

  it('counts tool-call name + serialized input', async () => {
    const messages: ModelMessage[] = [
      { role: 'assistant', content: [{ type: 'tool-call', toolCallId: 't1', toolName: 'fetch', input: { url: 'x' } }] }
    ]
    const inputJson = JSON.stringify({ url: 'x' })
    expect(await estimateModelMessagesFootprint(messages, { dialect: 'openai', tokenizer: fake })).toBe(
      MESSAGE_OVERHEAD + TOOL_OVERHEAD + 'fetch'.length + inputJson.length
    )
  })

  it('counts a plain system string', async () => {
    const messages: ModelMessage[] = [{ role: 'system', content: 'you are helpful' }]
    expect(await estimateModelMessagesFootprint(messages, { dialect: 'openai', tokenizer: fake })).toBe(
      MESSAGE_OVERHEAD + 'you are helpful'.length
    )
  })

  it('counts an unknown/future part type as zero (forward-compatible, no throw)', async () => {
    const messages = [{ role: 'user', content: [{ type: 'mystery' }] }] as unknown as ModelMessage[]
    expect(await estimateModelMessagesFootprint(messages, { dialect: 'openai', tokenizer: fake })).toBe(
      MESSAGE_OVERHEAD
    )
  })

  // #17837: a file part's base64 payload must never reach the tokenizer. A 13 MB MP3 is
  // ~18 M base64 chars, which scored ~3.7 M tokens against the provider's real 20 k.
  it('prices an audio file part by modality, never by its base64 length', async () => {
    const huge = 'A'.repeat(500_000)
    const messages: ModelMessage[] = [
      { role: 'user', content: [{ type: 'file', data: huge, mediaType: 'audio/mpeg', filename: 'clip.mp3' }] }
    ]
    const count = await estimateModelMessagesFootprint(messages, { dialect: 'google', tokenizer: fake })
    expect(count).toBe(MESSAGE_OVERHEAD + mediaTokensFor('google', 'audio'))
    expect(count).toBeLessThan(huge.length / 100)
  })

  it('prices a video file part by modality too', async () => {
    const messages: ModelMessage[] = [
      { role: 'user', content: [{ type: 'file', data: 'A'.repeat(200_000), mediaType: 'video/mp4' }] }
    ]
    expect(await estimateModelMessagesFootprint(messages, { dialect: 'google', tokenizer: fake })).toBe(
      MESSAGE_OVERHEAD + mediaTokensFor('google', 'video')
    )
  })

  it('prices audio nested in a tool-result content item by modality', async () => {
    const messages: ModelMessage[] = [
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 't1',
            toolName: 'rec',
            output: { type: 'content', value: [{ type: 'media', data: 'A'.repeat(200_000), mediaType: 'audio/wav' }] }
          }
        ]
      }
    ]
    expect(await estimateModelMessagesFootprint(messages, { dialect: 'google', tokenizer: fake })).toBe(
      MESSAGE_OVERHEAD + TOOL_OVERHEAD + mediaTokensFor('google', 'audio')
    )
  })
})

/**
 * The in-loop compaction hook calls the sync walker directly (it runs on every step and
 * cannot await a decode). Text must cost exactly the same on both paths, or the compaction
 * trigger and the gateway `count_tokens` would disagree about the same prompt.
 */
describe('estimateModelMessagesSync', () => {
  it('matches the async path exactly for text/tool content', async () => {
    const messages: ModelMessage[] = [
      { role: 'system', content: 'you are helpful' },
      { role: 'user', content: 'hello there' },
      { role: 'assistant', content: [{ type: 'tool-call', toolCallId: 't1', toolName: 'fetch', input: { url: 'x' } }] },
      {
        role: 'tool',
        content: [{ type: 'tool-result', toolCallId: 't1', toolName: 'fetch', output: { type: 'text', value: 'ok' } }]
      }
    ]
    const asyncCount = await estimateModelMessagesFootprint(messages, { dialect: 'anthropic', tokenizer: fake })
    expect(estimateModelMessagesSync(messages, { dialect: 'anthropic', tokenizer: fake })).toBe(asyncCount)
  })

  it('falls back to the per-dialect constant for media when given no measurements', () => {
    const messages: ModelMessage[] = [
      { role: 'user', content: [{ type: 'image', image: PNG_1x1, mediaType: 'image/png' }] }
    ]
    // No measurement pass → the dimensionless constant, not the decoded 1×1 pixel formula.
    expect(estimateModelMessagesSync(messages, { dialect: 'anthropic', tokenizer: fake })).toBe(MESSAGE_OVERHEAD + 1590)
  })

  it('uses measurements when they are supplied (same numbers as the async path)', async () => {
    const messages: ModelMessage[] = [
      { role: 'user', content: [{ type: 'image', image: PNG_1x1, mediaType: 'image/png' }] }
    ]
    const measure = await measureMedia(messages)
    // Decoded 1×1 → ceil(1·1/750) = 1 token.
    expect(estimateModelMessagesSync(messages, { dialect: 'anthropic', tokenizer: fake, measure })).toBe(
      MESSAGE_OVERHEAD + 1
    )
  })
})

describe('countToolTokens', () => {
  it('counts the stringified {name, description, schema}', () => {
    const text = JSON.stringify({ name: 'x', description: 'd', schema: { type: 'object' } })
    expect(countToolTokens({ name: 'x', description: 'd', schema: { type: 'object' } }, fake)).toBe(text.length)
  })
})

describe('countToolDefs', () => {
  it('sums per-tool overhead + serialized {name, description, schema} (input_schema is canonical)', () => {
    const tools = [{ name: 'a', description: 'desc', input_schema: { type: 'object' } }]
    const json = JSON.stringify({ name: 'a', description: 'desc', schema: { type: 'object' } })
    expect(countToolDefs(tools, fake)).toBe(TOOL_OVERHEAD + json.length)
  })

  it('returns 0 for missing / non-array tools', () => {
    expect(countToolDefs(undefined, fake)).toBe(0)
    expect(countToolDefs('nope', fake)).toBe(0)
    expect(countToolDefs([null, 42], fake)).toBe(0)
  })
})
