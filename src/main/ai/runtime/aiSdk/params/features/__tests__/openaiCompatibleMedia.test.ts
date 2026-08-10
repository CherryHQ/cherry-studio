/**
 * Deliverability test: the middleware's output is pushed through the *real*
 * `OpenAICompatibleChatLanguageModel` and the serialized request body is
 * asserted. Checking the middleware's own output would pass even if the
 * converter stopped spreading `providerOptions.openaiCompatible` last — which
 * is the entire mechanism this feature rests on.
 */

import { OpenAICompatibleChatLanguageModel } from '@ai-sdk/openai-compatible'
import type { LanguageModelV3Prompt } from '@ai-sdk/provider'
import { describe, expect, it } from 'vitest'

import { createOpenAICompatibleMediaMiddleware } from '../openaiCompatibleMedia'

const CHAT_RESPONSE = {
  id: 'r1',
  created: 0,
  model: 'm1',
  choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }]
}

/** Run a prompt through the middleware + the real converter, return the wire body. */
async function wireBody(prompt: LanguageModelV3Prompt, options = { audioAsDataUrl: false }) {
  const middleware = createOpenAICompatibleMediaMiddleware(options)
  const params = { prompt } as Parameters<NonNullable<typeof middleware.transformParams>>[0]['params']
  const transformed = await middleware.transformParams!({ params, type: 'generate', model: {} as never })

  let sent: Record<string, unknown> | undefined
  const model = new OpenAICompatibleChatLanguageModel('m1', {
    provider: 'openaiCompatible.chat',
    url: () => 'https://example.test/v1/chat/completions',
    headers: () => ({}),
    fetch: (async (_url: unknown, init: RequestInit) => {
      sent = JSON.parse(String(init.body))
      return new Response(JSON.stringify(CHAT_RESPONSE), { headers: { 'content-type': 'application/json' } })
    }) as never
  })
  await model.doGenerate(transformed)
  return (sent as { messages: { role: string; content: unknown }[] }).messages[0]
}

const VIDEO: LanguageModelV3Prompt = [
  {
    role: 'user',
    content: [
      { type: 'text', text: 'what happens here?' },
      { type: 'file', mediaType: 'video/mp4', filename: 'clip.mp4', data: 'AAEC' }
    ]
  }
]

describe('openai-compatible media rewrite', () => {
  it('sends a video file part as a video_url content part', async () => {
    const message = await wireBody(VIDEO)

    expect(message.content).toEqual([
      { type: 'text', text: 'what happens here?' },
      { type: 'video_url', video_url: { url: 'data:video/mp4;base64,AAEC' } }
    ])
  })

  it('keeps an attachment-only message multi-part so it is not collapsed to a string', async () => {
    const message = await wireBody([{ role: 'user', content: [VIDEO[0].content[1]] }] as LanguageModelV3Prompt)

    expect(Array.isArray(message.content)).toBe(true)
    expect(message.content).toContainEqual({ type: 'video_url', video_url: { url: 'data:video/mp4;base64,AAEC' } })
  })

  it.each([
    ['audio/ogg', 'ogg'],
    ['audio/flac', 'flac'],
    ['audio/aac', 'aac'],
    ['audio/mpeg', 'mp3'],
    ['audio/x-wav', 'wav']
  ])('sends %s as input_audio (the converter rejects all but wav/mp3 on its own)', async (mediaType, format) => {
    const message = await wireBody([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'listen' },
          { type: 'file', mediaType, data: 'AAEC' }
        ]
      }
    ])

    expect(message.content).toEqual([
      { type: 'text', text: 'listen' },
      { type: 'input_audio', input_audio: { data: 'AAEC', format } }
    ])
  })

  it('sends a Base64 Data URL for DashScope, which documents that shape', async () => {
    const message = await wireBody(
      [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'listen' },
            { type: 'file', mediaType: 'audio/mp3', data: 'AAEC' }
          ]
        }
      ],
      { audioAsDataUrl: true }
    )

    expect(message.content).toEqual([
      { type: 'text', text: 'listen' },
      { type: 'input_audio', input_audio: { data: 'data:audio/mp3;base64,AAEC', format: 'mp3' } }
    ])
  })

  it('does not double-prefix a data URL that reached the part as-is', async () => {
    const message = await wireBody([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'what happens here?' },
          { type: 'file', mediaType: 'video/mp4', data: 'data:video/mp4;base64,AAEC' }
        ]
      }
    ])

    expect(message.content).toContainEqual({ type: 'video_url', video_url: { url: 'data:video/mp4;base64,AAEC' } })
  })

  it('leaves images and PDFs to the converter', async () => {
    const message = await wireBody([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'look' },
          { type: 'file', mediaType: 'image/png', data: 'AAEC' }
        ]
      }
    ])

    expect(message.content).toEqual([
      { type: 'text', text: 'look' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,AAEC' } }
    ])
  })
})
