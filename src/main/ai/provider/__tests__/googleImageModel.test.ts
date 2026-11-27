import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { describe, expect, it } from 'vitest'

describe('Google native image model routing', () => {
  it.each(['gemini-nano-banana-2.1', 'nano-banana-pro-preview'])(
    'generates images from %s through generateContent using the original API id',
    async (modelId) => {
      const requests: Array<{ url: string; body: unknown }> = []
      const google = createGoogleGenerativeAI({
        apiKey: 'test-key',
        fetch: async (input, init) => {
          requests.push({ url: String(input), body: JSON.parse(String(init?.body)) })
          return Response.json({
            candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: 'AQID' } }] } }]
          })
        }
      })

      const result = await google.image(modelId).doGenerate({
        prompt: 'a banana',
        n: 1,
        size: undefined,
        aspectRatio: undefined,
        seed: undefined,
        files: undefined,
        mask: undefined,
        providerOptions: {}
      })

      expect(result.images).toEqual(['AQID'])
      expect(requests).toEqual([
        {
          url: `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent`,
          body: expect.objectContaining({
            generationConfig: expect.objectContaining({ responseModalities: ['IMAGE'] })
          })
        }
      ])
    }
  )
})
