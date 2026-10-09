import { afterEach, describe, expect, it, vi } from 'vitest'

import { createOllamaWithImageModel } from '../ollama/ollamaProvider'

afterEach(() => vi.restoreAllMocks())

// Characterization: Ollama's image extension has no stable published API contract; existing endpoint preserved 2026-09-09.
describe('Ollama image adapter', () => {
  it.each([undefined, 'http://proxy.example/api'])(
    'uses the configured proxy fetch, canonical steps, and call headers (%s)',
    async (baseURL) => {
      const requests: Request[] = []
      const globalFetch = vi.spyOn(globalThis, 'fetch')
      const provider = createOllamaWithImageModel({
        baseURL,
        headers: { 'x-provider': 'cherry' },
        fetch: async (url, init) => {
          requests.push(new Request(url, init))
          return Response.json({ image: 'AQID' })
        }
      })
      const result = await provider.imageModel('x/z-image-turbo').doGenerate({
        prompt: 'a fox',
        n: 1,
        size: '512x512',
        seed: 0,
        aspectRatio: undefined,
        files: undefined,
        mask: undefined,
        providerOptions: { ollama: { numInferenceSteps: 9 } },
        headers: { 'x-call': 'once' }
      })
      expect(requests[0].url).toBe(`${baseURL ?? 'http://127.0.0.1:11434/api'}/generate`)
      expect(await requests[0].json()).toEqual({
        model: 'x/z-image-turbo',
        prompt: 'a fox',
        stream: false,
        width: 512,
        height: 512,
        steps: 9,
        options: { seed: 0 }
      })
      expect(requests[0].headers.get('x-provider')).toBe('cherry')
      expect(requests[0].headers.get('x-call')).toBe('once')
      expect(result.images).toEqual(['AQID'])
      expect(globalFetch).not.toHaveBeenCalled()
    }
  )
})
