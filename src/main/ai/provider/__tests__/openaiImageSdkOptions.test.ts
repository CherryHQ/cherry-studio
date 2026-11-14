import { createOpenAI } from '@ai-sdk/openai'
import type { ImageModelV3CallOptions } from '@ai-sdk/provider'
import { describe, expect, it } from 'vitest'

const baseOptions = {
  prompt: 'a small orange sun',
  n: 1,
  size: '1024x1024',
  aspectRatio: undefined,
  seed: undefined,
  files: undefined,
  mask: undefined,
  providerOptions: {}
} satisfies ImageModelV3CallOptions

function captureRequests() {
  const requests: Request[] = []
  const provider = createOpenAI({
    apiKey: 'fixture-key',
    baseURL: 'https://api.openai.com/v1',
    fetch: async (input, init) => {
      requests.push(new Request(input, init))
      return new Response(JSON.stringify({ data: [{ b64_json: 'QUJD' }] }), {
        headers: { 'content-type': 'application/json' }
      })
    }
  })
  return { requests, model: provider.imageModel('gpt-image-2.6-flare') }
}

describe('installed OpenAI image SDK options', () => {
  it.each(['generate', 'edit'] as const)('sends complexity on the %s endpoint', async (mode) => {
    const { model, requests } = captureRequests()
    await model.doGenerate({
      ...baseOptions,
      files: mode === 'edit' ? [{ type: 'file', mediaType: 'image/png', data: 'QUJD' }] : undefined,
      providerOptions: { openai: { complexity: 'low' } }
    })
    const request = requests[0]
    expect(request.url).toBe(`https://api.openai.com/v1/images/${mode === 'edit' ? 'edits' : 'generations'}`)
    if (mode === 'generate')
      expect(await request.json()).toMatchObject({ model: 'gpt-image-2.6-flare', complexity: 'low' })
    else expect((await request.formData()).get('complexity')).toBe('low')
  })

  it('serializes animated GIF options for generation', async () => {
    const { model, requests } = captureRequests()
    await model.doGenerate({
      ...baseOptions,
      providerOptions: { openai: { outputFormat: 'gif', frameCount: 9, frameDurationMs: 200, complexity: 'medium' } }
    })
    expect(await requests[0].json()).toEqual({
      model: 'gpt-image-2.6-flare',
      prompt: 'a small orange sun',
      n: 1,
      size: '1024x1024',
      output_format: 'gif',
      frame_count: 9,
      frame_duration_ms: 200,
      complexity: 'medium'
    })
  })

  it.each([
    { frameCount: 1, frameDurationMs: 200 },
    { frameCount: 65, frameDurationMs: 200 },
    { frameCount: 9, frameDurationMs: 19 },
    { frameCount: 9, frameDurationMs: 2001 }
  ])('rejects out-of-range GIF options before sending: %j', async (timing) => {
    const { model, requests } = captureRequests()
    await expect(
      model.doGenerate({
        ...baseOptions,
        providerOptions: { openai: { outputFormat: 'gif', ...timing } }
      })
    ).rejects.toThrow()
    expect(requests).toHaveLength(0)
  })

  it('rejects GIF output on the edit endpoint before uploading', async () => {
    const { model, requests } = captureRequests()
    await expect(
      model.doGenerate({
        ...baseOptions,
        files: [{ type: 'file', mediaType: 'image/png', data: 'QUJD' }],
        providerOptions: { openai: { outputFormat: 'gif' } }
      })
    ).rejects.toThrow()
    expect(requests).toHaveLength(0)
  })
})
