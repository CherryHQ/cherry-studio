import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createOpenAI } from '@ai-sdk/openai'
import { generateImage } from 'ai'
import { describe, expect, it } from 'vitest'

import type { ImageGenerationSupport } from '@shared/data/types/model'

import { buildGenerateImageToolSchema } from '../../tools/generateImageTool'
import { createAihubmixImageModel } from '../custom/aihubmix/aihubmixImageModel'
import { imageTransportInputCapabilities } from '../custom/imageTransportRegistry'
import { resolveImageInputCapabilities, validateImageInputs } from '../imageInputCapabilities'

const support: ImageGenerationSupport = {
  modes: { generate: { supports: {} }, edit: { supports: {}, maxInputImages: 2 } }
}
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aIo8AAAAASUVORK5CYII='
const dataUrl = `data:image/png;base64,${png}`

describe('image input capability policy', () => {
  it('vetoes registry edit support when the actual SDK adapter rejects files', async () => {
    const model = createOpenAI({ apiKey: 'test' }).image('dall-e-3')
    const result = await resolveImageInputCapabilities(support, true, model)
    expect(result.inputCapabilities.files).toBe(false)
    expect(result.modes.edit).toBeUndefined()
    expect(support.modes.edit?.maxInputImages).toBe(2)
    expect(buildGenerateImageToolSchema(result).safeParse({ prompt: 'Edit', image_ids: ['image'] }).success).toBe(false)
    expect(() => validateImageInputs({ inputImages: [dataUrl] }, result)).toThrow()
  })

  it('preserves declared custom routes when the SDK has no capability declaration', async () => {
    const result = await resolveImageInputCapabilities(support, true, {})
    expect(result.inputCapabilities).toEqual({ files: true, mask: undefined })
    expect(result.modes.edit?.maxInputImages).toBe(2)
    expect(() => validateImageInputs({ inputImages: [dataUrl] }, result)).not.toThrow()
    expect(() => validateImageInputs({ inputImages: [dataUrl], mask: dataUrl }, result)).toThrow()
  })

  it('does not promote unknown inputs to support or assume masks follow file support', async () => {
    const unknown = await resolveImageInputCapabilities(null, false, {})
    expect(unknown.inputCapabilities.files).toBeUndefined()
    expect(() => validateImageInputs({ inputImages: [dataUrl] }, unknown)).toThrow()
    const result = await resolveImageInputCapabilities(support, true, {
      supportsFileInputs: Promise.resolve(true),
      supportsMaskInputs: Promise.resolve(false)
    })
    expect(() => validateImageInputs({ inputImages: [dataUrl] }, result)).not.toThrow()
    expect(() => validateImageInputs({ inputImages: [dataUrl], mask: dataUrl }, result)).toThrow()
  })

  it('retains reference-image generation without inventing an edit operation', async () => {
    const result = await resolveImageInputCapabilities(
      { modes: { generate: { supports: {}, maxInputImages: 3 } } },
      true,
      {}
    )
    expect(result.modes.edit).toBeUndefined()
    const schema = buildGenerateImageToolSchema(result)
    expect(schema.safeParse({ prompt: 'Combine', image_ids: ['a', 'b', 'c'] }).success).toBe(true)
    expect(schema.safeParse({ prompt: 'Combine', image_ids: ['a', 'b', 'c', 'd'] }).success).toBe(false)
  })

  it('preserves model-declared reference input when generate metadata omits an input limit', async () => {
    const generationOnly = { modes: { generate: { supports: {} } } }
    const result = await resolveImageInputCapabilities(generationOnly, true, {})
    expect(result.inputCapabilities.files).toBe(true)
    expect(result.modes.edit).toBeUndefined()
    expect(() => validateImageInputs({ inputImages: [dataUrl] }, result)).not.toThrow()
    const unknown = await resolveImageInputCapabilities(generationOnly, false, {})
    expect(unknown.inputCapabilities.files).toBeUndefined()
    expect(() => validateImageInputs({ inputImages: [dataUrl] }, unknown)).toThrow()
  })

  it('limits custom transport masks to the route that serializes them', () => {
    expect(imageTransportInputCapabilities('dashscope', 'wanx2.1-imageedit').supportsMaskInputs).toBe(true)
    expect(imageTransportInputCapabilities('dashscope', 'qwen-image-edit').supportsMaskInputs).toBe(false)
    expect(imageTransportInputCapabilities('ppio', 'example').supportsMaskInputs).toBe(false)
  })
})

describe('installed image adapters', () => {
  it('retains native capability declarations through the AiHubMix Google wrapper', async () => {
    const model = createAihubmixImageModel('gemini-2.5-flash-image', {
      baseURL: 'https://example.invalid/v1',
      resolveApiKey: () => '',
      headers: () => ({})
    })
    const result = await resolveImageInputCapabilities(support, true, model)
    expect(result.inputCapabilities).toEqual({ files: true, mask: false })
  })

  it('delivers both reference and mask bytes through the approved OpenAI route', async () => {
    let form: FormData | undefined
    const model = createOpenAI({
      apiKey: 'test',
      fetch: async (url, init) => {
        expect(String(url)).toBe('https://api.openai.com/v1/images/edits')
        form = init?.body as FormData
        return Response.json({ created: 0, data: [{ b64_json: png }] })
      }
    }).image('gpt-image-1')
    const capabilities = await resolveImageInputCapabilities(support, true, model)
    const request = { inputImages: [dataUrl], mask: dataUrl }
    validateImageInputs(request, capabilities)
    const result = await generateImage({
      model,
      prompt: { text: 'Blue', images: request.inputImages, mask: request.mask }
    })
    expect(form).toBeInstanceOf(FormData)
    expect(Buffer.from(await (form!.get('image') as File).arrayBuffer()).toString('base64')).toBe(png)
    expect(Buffer.from(await (form!.get('mask') as File).arrayBuffer()).toString('base64')).toBe(png)
    expect(result.image.base64).toBe(png)
    expect(() => validateImageInputs({ inputImages: [], mask: dataUrl }, capabilities)).toThrow()
  })

  it('rejects Gemini masks before any provider request while retaining image input', async () => {
    let requests = 0
    const model = createGoogleGenerativeAI({
      apiKey: 'test',
      fetch: async () => {
        requests++
        throw new Error('Unexpected request')
      }
    }).image('gemini-2.5-flash-image')
    const capabilities = await resolveImageInputCapabilities(support, true, model)
    expect(capabilities.inputCapabilities).toEqual({ files: true, mask: false })
    expect(() => validateImageInputs({ inputImages: [dataUrl], mask: dataUrl }, capabilities)).toThrow()
    expect(requests).toBe(0)
  })
})
