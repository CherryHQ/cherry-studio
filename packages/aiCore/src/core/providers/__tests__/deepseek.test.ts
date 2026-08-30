import { createDeepSeek } from '@ai-sdk/deepseek'
import { generateText } from 'ai'
import { describe, expect, it, vi } from 'vitest'

describe('DeepSeek provider', () => {
  it('forwards image parts to vision models', async () => {
    const fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string)

      expect(body.messages).toEqual([
        {
          role: 'user',
          content: [
            { type: 'text', text: 'What is in this image?' },
            {
              type: 'image_url',
              image_url: { url: 'data:image/png;base64,aGVsbG8=' }
            }
          ]
        }
      ])

      return new Response(
        JSON.stringify({
          id: 'response-1',
          model: 'deepseek-v4-flash-vision-exp',
          choices: [{ message: { role: 'assistant', content: 'An image.' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
        }),
        { headers: { 'content-type': 'application/json' } }
      )
    })

    await generateText({
      model: createDeepSeek({ apiKey: 'test-key', fetch })('deepseek-v4-flash-vision-exp'),
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'What is in this image?' },
            { type: 'image', image: 'aGVsbG8=', mediaType: 'image/png' }
          ]
        }
      ]
    })
  })
})
