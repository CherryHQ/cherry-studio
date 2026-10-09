import type { ImageModelV3CallOptions } from '@ai-sdk/provider'
import { describe, expect, it } from 'vitest'

import { createCherryIn } from '../cherryin-provider'

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jD1sAAAAASUVORK5CYII='

// Google ImageConfig: https://ai.google.dev/api/generate-content#ImageConfig — retrieved 2026-10-08.
describe('CherryIN Google image ratio ownership', () => {
  it.each([undefined, '16:9'] as const)(
    'uses only the native ratio %s and preserves unrelated Google configuration',
    async (aspectRatio) => {
      const requests: Request[] = []
      const model = createCherryIn({
        apiKey: 'test-key',
        geminiBaseURL: 'https://image.example/v1beta',
        fetch: async (input, init) => {
          requests.push(new Request(input, init))
          return Response.json({
            candidates: [
              {
                content: { role: 'model', parts: [{ inlineData: { mimeType: 'image/png', data: PNG } }] },
                finishReason: 'STOP'
              }
            ]
          })
        }
      }).image('gemini-3-pro-image-preview')
      const options: ImageModelV3CallOptions = {
        prompt: 'a fox',
        n: 1,
        // @ts-expect-error The app's size bag may contain a ratio-looking string; it must not become a ratio.
        size: '3:2',
        aspectRatio,
        seed: undefined,
        providerOptions: {
          openai: { aspectRatio: '4:3' },
          cherryin: { aspectRatio: 'ASPECT_9_16', aspect_ratio: '1:1' },
          google: { aspectRatio: '1:1', imageConfig: { aspectRatio: '1:1', imageSize: '2K' } }
        },
        headers: undefined,
        files: undefined,
        mask: undefined
      }
      const result = await model.doGenerate(options)
      const body = await requests[0].json()
      expect(body.generationConfig.imageConfig).toEqual(
        aspectRatio === undefined ? { imageSize: '2K' } : { imageSize: '2K', aspectRatio: '16:9' }
      )
      expect(result.images).toEqual([PNG])
    }
  )
})
