import { describe, expect, it } from 'vitest'

import { definePlugin } from '../../plugins'
import { resolveLanguageModel } from '../index'

describe('resolveLanguageModel', () => {
  it.each([false, true])(
    'adapts a V3 provider to V4 before applying fallback middleware (middleware: %s)',
    async (middleware) => {
      let body: Record<string, any> | undefined
      const model = await resolveLanguageModel(
        'openai-chat',
        {
          apiKey: 'test',
          fetch: async (_url, init) => {
            body = JSON.parse(String(init?.body))
            return Response.json({
              id: 'chat-1',
              model: 'gpt-4o',
              created: 0,
              choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: 'Read image' } }]
            })
          }
        },
        'gpt-4o',
        middleware
          ? [
              definePlugin({
                name: 'fallback-temperature',
                configureContext: (context) => {
                  context.middlewares = [
                    {
                      specificationVersion: 'v4',
                      transformParams: async ({ params }) => ({ ...params, temperature: 0.2 })
                    }
                  ]
                }
              })
            ]
          : []
      )
      expect(model.specificationVersion).toBe('v4')
      const result = await model.doGenerate({
        temperature: 0.8,
        prompt: [
          {
            role: 'user',
            content: [
              {
                type: 'file',
                mediaType: 'image/png',
                data: { type: 'url', url: new URL('https://images.example/cherry.png') }
              }
            ]
          }
        ]
      })
      expect(result.content).toContainEqual({ type: 'text', text: 'Read image' })
      expect(body?.temperature).toBe(middleware ? 0.2 : 0.8)
      expect(body?.messages).toEqual([
        { role: 'user', content: [{ type: 'image_url', image_url: { url: 'https://images.example/cherry.png' } }] }
      ])
    }
  )
})
