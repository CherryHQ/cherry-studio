import { createOpenRouter } from '@openrouter/ai-sdk-provider'
import { generateText } from 'ai'
import { describe, expect, it, vi } from 'vitest'

import { createNewApi } from '../newapiProvider'

const IMAGE = 'data:image/png;base64,iVBORw0KGgo='

describe('image chat history', () => {
  it.each(['openrouter', 'newapi'] as const)(
    'keeps tool results adjacent to their %s call when replaying images',
    async (provider) => {
      const requests: { messages: { role: string; content: unknown; tool_calls?: unknown[] }[] }[] = []
      const fetch = vi.fn<typeof globalThis.fetch>(async (_url, init) => {
        requests.push(JSON.parse(init?.body as string))
        return Response.json({
          id: 'tool-turn',
          choices: [{ index: 0, message: { role: 'assistant', content: 'Done' }, finish_reason: 'stop' }]
        })
      })
      const model =
        provider === 'openrouter'
          ? createOpenRouter({ apiKey: 'test', fetch }).chat('google/gemini-image')
          : createNewApi({ apiKey: 'test', baseURL: 'https://newapi.test/v1', fetch }).languageModel('image')
      await model.doGenerate({
        prompt: [
          { role: 'user', content: [{ type: 'text', text: 'Draw a cat and check the weather' }] },
          {
            role: 'assistant',
            content: [
              { type: 'text', text: 'A cat.' },
              { type: 'file', mediaType: 'image/png', data: new URL(IMAGE) },
              { type: 'tool-call', toolCallId: 'weather-1', toolName: 'weather', input: {} }
            ]
          },
          {
            role: 'tool',
            content: [
              {
                type: 'tool-result',
                toolCallId: 'weather-1',
                toolName: 'weather',
                output: { type: 'text', value: 'Sunny' }
              }
            ]
          },
          { role: 'user', content: [{ type: 'text', text: 'Make its background blue' }] }
        ]
      })
      const messages = requests[0].messages
      expect(messages.map(({ role }) => role)).toEqual(['user', 'assistant', 'tool', 'user', 'user'])
      expect(messages[1]).toMatchObject({
        content: 'A cat.',
        tool_calls: [{ id: 'weather-1', type: 'function', function: { name: 'weather', arguments: '{}' } }]
      })
      expect(messages[2]).toMatchObject({ tool_call_id: 'weather-1', content: 'Sunny' })
      expect(messages[3].content).toEqual([{ type: 'image_url', image_url: { url: IMAGE } }])
      expect(messages[4].content).toBe('Make its background blue')
    }
  )

  it.each([
    ['openrouter', 'A cat.'],
    ['openrouter', ''],
    ['newapi', 'A cat.'],
    ['newapi', '']
  ] as const)('replays generated images on the next %s turn (text: %s)', async (provider, content) => {
    const requests: { messages: unknown[] }[] = []
    const fetch = vi.fn<typeof globalThis.fetch>(async (_url, init) => {
      requests.push(JSON.parse(init?.body as string))
      return Response.json({
        id: 'image-turn',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content,
              images: [{ type: 'image_url', image_url: { url: IMAGE } }]
            },
            finish_reason: 'stop'
          }
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
      })
    })
    const model =
      provider === 'openrouter'
        ? createOpenRouter({ apiKey: 'test', fetch }).chat('google/gemini-image')
        : createNewApi({ apiKey: 'test', baseURL: 'https://newapi.test/v1', fetch }).languageModel('image')
    const first = await generateText({ model, prompt: 'Draw a cat', maxRetries: 0 })

    await generateText({
      model,
      messages: [
        { role: 'user', content: 'Draw a cat' },
        ...first.response.messages,
        { role: 'user', content: 'Make its background blue' }
      ],
      maxRetries: 0
    })

    expect(
      requests[1].messages.map((value) => {
        const message = value as { role: string; content: unknown }
        return { role: message.role, content: message.content }
      })
    ).toEqual([
      { role: 'user', content: 'Draw a cat' },
      ...(content ? [{ role: 'assistant', content }] : []),
      { role: 'user', content: [{ type: 'image_url', image_url: { url: IMAGE } }] },
      { role: 'user', content: 'Make its background blue' }
    ])
  })
})
