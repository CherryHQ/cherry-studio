import { describe, expect, it } from 'vitest'
import * as z from 'zod'

import { createDashScopeTransport } from '../../dashscope/dashscopeTransport'
import type { ImageGenerationSubmitInput } from '../../imageGenerationModel'
import { captureImageRequest } from './captureRequest'

/**
 * DashScope request boundary — one body family per model id, POSTed to the
 * descriptor endpoint. Covers text2image (flat input), chat-like (messages[]),
 * wanx-v1 (ref_image), wan2.5 i2i (images[]), qwen-mt (image_url + langs) and
 * wanx2.1-imageedit (function + base_image_url). size is converted `x`→`*`.
 */
const host = 'https://dashscope.aliyuncs.com'
const file = (bytes: number[]) =>
  [{ mediaType: 'image/png', data: new Uint8Array(bytes) }] as ImageGenerationSubmitInput['files']

const base = {
  n: 1,
  size: undefined,
  seed: undefined,
  files: undefined,
  mask: undefined
} satisfies Partial<ImageGenerationSubmitInput>

const descriptor = (id: string, mode: string) => ({
  id,
  endpoint: '/api/v1/services/aigc/image',
  isSync: false,
  mode
})

const messagePart = z.union([z.strictObject({ text: z.string() }), z.strictObject({ image: z.string() })])

interface Case {
  name: string
  input: ImageGenerationSubmitInput
  schema: z.ZodTypeAny
}

const CASES: Case[] = [
  {
    name: 'text2image (qwen-image) → input.prompt + parameters.size/seed',
    input: {
      ...base,
      modelId: 'qwen-image',
      prompt: 'a fox',
      size: '1024x1024',
      providerParams: { modelDescriptor: descriptor('qwen-image', 'generate'), seed: 42 }
    } as ImageGenerationSubmitInput,
    schema: z.strictObject({
      model: z.string(),
      input: z.strictObject({ prompt: z.string() }),
      parameters: z.strictObject({ size: z.string(), seed: z.number().int() })
    })
  },
  {
    name: 'chat-like (qwen-image-edit) → messages[] with inlined image',
    input: {
      ...base,
      modelId: 'qwen-image-edit',
      prompt: 'a fox',
      files: file([1, 2, 3]),
      providerParams: { modelDescriptor: descriptor('qwen-image-edit', 'edit') }
    } as ImageGenerationSubmitInput,
    schema: z.strictObject({
      model: z.string(),
      input: z.strictObject({
        messages: z.array(z.strictObject({ role: z.literal('user'), content: z.array(messagePart) }))
      })
    })
  },
  {
    name: 'wanx-v1 → input.ref_image + parameters.style/ref_*',
    input: {
      ...base,
      modelId: 'wanx-v1',
      prompt: 'a fox',
      size: '1024x1024',
      files: file([9]),
      providerParams: {
        modelDescriptor: descriptor('wanx-v1', 'generate'),
        seed: 7,
        style: '<photography>',
        refStrength: 0.5,
        refMode: 'repaint'
      }
    } as ImageGenerationSubmitInput,
    schema: z.strictObject({
      model: z.string(),
      input: z.strictObject({ prompt: z.string(), ref_image: z.string() }),
      parameters: z.strictObject({
        size: z.string(),
        seed: z.number().int(),
        style: z.string(),
        ref_strength: z.number(),
        ref_mode: z.string()
      })
    })
  },
  {
    name: 'wan2.5-i2i → input.images[]',
    input: {
      ...base,
      modelId: 'wan2.5-i2i-preview',
      prompt: 'a fox',
      size: '1024x1024',
      files: [
        { mediaType: 'image/png', data: new Uint8Array([1]) },
        { mediaType: 'image/jpeg', data: new Uint8Array([2]) }
      ] as ImageGenerationSubmitInput['files'],
      providerParams: { modelDescriptor: descriptor('wan2.5-i2i-preview', 'edit') }
    } as ImageGenerationSubmitInput,
    schema: z.strictObject({
      model: z.string(),
      input: z.strictObject({ prompt: z.string(), images: z.array(z.string()) }),
      parameters: z.strictObject({ size: z.string() })
    })
  },
  {
    name: 'qwen-mt-image → input.image_url + source/target lang (no prompt)',
    input: {
      ...base,
      modelId: 'qwen-mt-image',
      prompt: undefined,
      files: file([4, 5, 6]),
      providerParams: { modelDescriptor: descriptor('qwen-mt-image', 'generate'), sourceLang: 'auto', targetLang: 'en' }
    } as ImageGenerationSubmitInput,
    schema: z.strictObject({
      model: z.string(),
      input: z.strictObject({ image_url: z.string(), source_lang: z.string(), target_lang: z.string() })
    })
  },
  {
    name: 'wanx2.1-imageedit → input.function + base_image_url + parameters',
    input: {
      ...base,
      modelId: 'wanx2.1-imageedit',
      prompt: 'a fox',
      files: file([7, 8]),
      providerParams: {
        modelDescriptor: descriptor('wanx2.1-imageedit', 'edit'),
        function: 'super_resolution',
        upscaleFactor: 2,
        addWatermark: true,
        seed: 3
      }
    } as ImageGenerationSubmitInput,
    schema: z.strictObject({
      model: z.string(),
      input: z.strictObject({ function: z.string(), prompt: z.string(), base_image_url: z.string() }),
      parameters: z.strictObject({ seed: z.number().int(), watermark: z.boolean(), upscale_factor: z.number() })
    })
  }
]

describe('DashScope request boundary', () => {
  const transport = createDashScopeTransport({ apiKey: 'ds-key', imageBaseURL: host })

  for (const c of CASES) {
    it(`${c.name}: satisfies the wire contract and matches snapshot`, async () => {
      const req = await captureImageRequest(transport, c.input)
      expect(req.url).toBe(`${host}/api/v1/services/aigc/image`)
      c.schema.parse(req.body)
      expect(req.body).toMatchSnapshot()
    })
  }
})
