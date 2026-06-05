import { describe, expect, it } from 'vitest'
import * as z from 'zod'

import type { ImageGenerationSubmitInput } from '../../imageGenerationModel'
import { createPpioTransport } from '../../ppio/ppioTransport'
import { captureImageRequest } from './captureRequest'

/**
 * PPIO request boundary — one body builder per model id, POSTed to the
 * descriptor's endpoint. Each fixture pins one builder's wire shape (dimension
 * split, `size` `x`→`*`, plural `images`, distinct watermark keys, loras, …).
 * `modelDescriptor` (id + endpoint + mode) is threaded through providerParams
 * by the painting pipeline at runtime; here it is supplied per fixture.
 */
const base = {
  n: 1,
  size: undefined,
  seed: undefined,
  files: undefined,
  mask: undefined,
  providerParams: {}
} satisfies Partial<ImageGenerationSubmitInput>

const host = 'https://api.ppio.com'

interface Case {
  name: string
  endpoint: string
  mode: string
  input: ImageGenerationSubmitInput
  schema: z.ZodTypeAny
}

function fixture(opts: {
  name: string
  id: string
  endpoint: string
  mode?: string
  size?: string
  seed?: number
  files?: ImageGenerationSubmitInput['files']
  params?: Record<string, unknown>
  schema: z.ZodTypeAny
}): Case {
  const mode = opts.mode ?? 'generate'
  return {
    name: opts.name,
    endpoint: opts.endpoint,
    mode,
    schema: opts.schema,
    input: {
      ...base,
      modelId: opts.id,
      prompt: 'a fox',
      size: opts.size,
      seed: opts.seed,
      files: opts.files,
      providerParams: { modelDescriptor: { id: opts.id, endpoint: opts.endpoint, isSync: false, mode }, ...opts.params }
    } as ImageGenerationSubmitInput
  }
}

// `[1, 2, 3]` base64-encodes to `AQID`, so `fileToDataUrl` yields
// `data:image/png;base64,AQID` — the canonical attached-image path the
// painting pipeline feeds edit models via `inputImages` → `options.files`.
const editFiles = [{ mediaType: 'image/png', data: new Uint8Array([1, 2, 3]) }] as ImageGenerationSubmitInput['files']

const CASES: Case[] = [
  fixture({
    name: 'jimeng — width/height split + use_pre_llm + logo_info',
    id: 'jimeng-txt2img-v3.1',
    endpoint: '/v3/async/jimeng-txt2img-v3.1',
    size: '1024x1024',
    seed: 42,
    params: { usePreLlm: true, addWatermark: true },
    schema: z.strictObject({
      prompt: z.string(),
      use_pre_llm: z.boolean(),
      seed: z.number().int(),
      width: z.number().int().positive(),
      height: z.number().int().positive(),
      logo_info: z.strictObject({ add_logo: z.literal(true) })
    })
  }),
  fixture({
    name: 'hunyuan — size x→* + watermark',
    id: 'hunyuan-image-3',
    endpoint: '/v3/async/hunyuan-image-3',
    size: '1024x1024',
    seed: 7,
    params: { addWatermark: false },
    schema: z.strictObject({ prompt: z.string(), size: z.string(), seed: z.number().int(), watermark: z.boolean() })
  }),
  fixture({
    name: 'qwen-image-txt2img — size x→* + watermark',
    id: 'qwen-image-txt2img',
    endpoint: '/v3/async/qwen-image-txt2img',
    size: '1024x1024',
    params: { addWatermark: true },
    schema: z.strictObject({ prompt: z.string(), size: z.string(), watermark: z.boolean() })
  }),
  fixture({
    // Live registry edit id (no `apiModelId`, so it reaches the transport
    // verbatim). Pins the `qwen-image-edit-2509` switch arm + `input.files`
    // image plumbing — the gap this fixture set previously masked.
    name: 'qwen-image-edit-2509 — image from files + output_format + seed',
    id: 'qwen-image-edit-2509',
    endpoint: '/v3/async/qwen-image-edit-2509',
    mode: 'edit',
    seed: 5,
    files: editFiles,
    params: { outputFormat: 'png', addWatermark: false },
    schema: z.strictObject({
      prompt: z.string(),
      image: z.string(),
      seed: z.number().int(),
      output_format: z.string(),
      watermark: z.boolean()
    })
  }),
  fixture({
    name: 'qwen-image-edit — image from files + output_format + seed',
    id: 'qwen-image-edit',
    endpoint: '/v3/async/qwen-image-edit',
    mode: 'edit',
    seed: 5,
    files: editFiles,
    params: { outputFormat: 'png', addWatermark: false },
    schema: z.strictObject({
      prompt: z.string(),
      image: z.string(),
      seed: z.number().int(),
      output_format: z.string(),
      watermark: z.boolean()
    })
  }),
  fixture({
    name: 'glm-image — quality + watermark_enabled',
    id: 'glm-image',
    endpoint: '/v3/async/glm-image',
    size: '1280x1280',
    params: { addWatermark: true },
    schema: z.strictObject({
      prompt: z.string(),
      size: z.string(),
      quality: z.literal('hd'),
      watermark_enabled: z.boolean()
    })
  }),
  fixture({
    name: 'z-image-turbo-lora — size x→* + seed + loras',
    id: 'z-image-turbo-lora',
    endpoint: '/v3/async/z-image-turbo-lora',
    size: '1024x1024',
    seed: 1,
    schema: z.strictObject({
      prompt: z.string(),
      size: z.string(),
      seed: z.number().int(),
      loras: z.array(z.unknown())
    })
  }),
  fixture({
    name: 'seedream-4.0 draw — sequential_image_generation',
    id: 'seedream-4.0',
    endpoint: '/v3/seedream-4.0',
    size: '2048x2048',
    params: { addWatermark: true },
    schema: z.strictObject({
      prompt: z.string(),
      size: z.string(),
      watermark: z.boolean(),
      sequential_image_generation: z.literal('disabled')
    })
  }),
  fixture({
    name: 'seedream-4.0 edit — plural images[]',
    id: 'seedream-4.0',
    endpoint: '/v3/seedream-4.0',
    mode: 'edit',
    size: '2048x2048',
    files: editFiles,
    params: { addWatermark: true },
    schema: z.strictObject({
      prompt: z.string(),
      images: z.array(z.string()),
      size: z.string(),
      watermark: z.boolean(),
      sequential_image_generation: z.literal('disabled')
    })
  })
]

describe('PPIO request boundary', () => {
  const transport = createPpioTransport({ apiKey: 'ppio-key', baseURL: host })

  for (const c of CASES) {
    it(`${c.name}: satisfies the wire contract and matches snapshot`, async () => {
      const req = await captureImageRequest(transport, c.input)
      expect(req.url).toBe(`${host}${c.endpoint}`)
      c.schema.parse(req.body)
      expect(req.body).toMatchSnapshot()
    })
  }
})
