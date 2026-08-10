/**
 * Deliverability test: the middleware's output is pushed through the *real*
 * `OpenAICompatibleChatLanguageModel` and the serialized request body is
 * asserted. Checking the middleware's own output would pass even if the
 * converter stopped spreading `providerOptions.openaiCompatible` last — which
 * is the entire mechanism this feature rests on.
 */

import { OpenAICompatibleChatLanguageModel } from '@ai-sdk/openai-compatible'
import type { LanguageModelV3Prompt } from '@ai-sdk/provider'
import { ENDPOINT_TYPE, type EndpointType } from '@shared/data/types/model'
import { describe, expect, it } from 'vitest'

import type { RequestScope } from '../../scope'
import { createOpenAICompatibleMediaMiddleware, openaiCompatibleMediaFeature } from '../openaiCompatibleMedia'

const CHAT_RESPONSE = {
  id: 'r1',
  created: 0,
  model: 'm1',
  choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }]
}

/** Run a prompt through the middleware + the real converter, return the wire body. */
async function wireBody(prompt: LanguageModelV3Prompt) {
  const middleware = createOpenAICompatibleMediaMiddleware()
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

    expect(message.content).toEqual([
      { type: 'text', text: ' ' },
      { type: 'video_url', video_url: { url: 'data:video/mp4;base64,AAEC' } }
    ])
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

    expect(message.content).toEqual([
      { type: 'text', text: 'what happens here?' },
      { type: 'video_url', video_url: { url: 'data:video/mp4;base64,AAEC' } }
    ])
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

/**
 * The rewrite is destructive: a converter that ignores `providerOptions.openaiCompatible`
 * forwards an empty text part and loses the file with no note. Activation therefore has to
 * be certain about the model class, not merely about the resolved endpoint.
 */
describe('openai-compatible media activation', () => {
  const ALL_ENDPOINTS = {
    [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl: 'https://x.test' },
    [ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT]: { baseUrl: 'https://x.test' }
  }

  const scope = (providerId: string, endpointType: EndpointType, apiModelId = 'some-model'): RequestScope =>
    ({
      provider: { id: providerId, endpointConfigs: ALL_ENDPOINTS },
      model: { id: `${providerId}::${apiModelId}`, apiModelId },
      sdkConfig: { providerId },
      endpointType
    }) as unknown as RequestScope

  const applies = (s: RequestScope) => openaiCompatibleMediaFeature.applies!(s)

  it('applies to the generic openai-compatible adapter', () => {
    expect(applies(scope('openai-compatible', ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS))).toBe(true)
  })

  it('skips Vercel AI Gateway, which forwards file parts verbatim and converts server-side', () => {
    expect(applies(scope('gateway', ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS))).toBe(false)
  })

  it("skips @ai-sdk/openai's own chat converter", () => {
    expect(applies(scope('openai-chat', ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS))).toBe(false)
  })

  it('applies to a multi-backend gateway on its compat route', () => {
    expect(applies(scope('aihubmix', ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS, 'some-compat-model'))).toBe(true)
  })

  it('skips a multi-backend gateway whose model dispatches to another SDK class', () => {
    // AiHubMix routes `gemini-*` to GoogleGenerativeAILanguageModel by model id; a model row
    // pinning openai-chat-completions would otherwise install the middleware for that dispatch.
    expect(applies(scope('aihubmix', ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS, 'gemini-2.5-pro'))).toBe(false)
  })
})
