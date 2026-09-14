import { describe, expect, it, vi } from 'vitest'
import * as z from 'zod'

import { registryImageDescriptor } from '../../../__tests__/imageCatalogFixtures'
import type { ImageGenerationSubmitInput, ImageTransportDescriptor } from '../../imageGenerationModel'
import type { PpioBag } from '../../ppio/ppioTransport'
import { createPpioTransport } from '../../ppio/ppioTransport'
import { captureImageRequest } from './captureRequest'

// Contract sources: https://ppio.com/docs/models/reference-seedream-4.0 and the per-model API pages below.
// Retrieved 2026-09-09; descriptors come from the served registry, not reconstructed model aliases.
const base = {
  n: 1,
  size: undefined,
  seed: undefined,
  files: undefined,
  mask: undefined,
  providerParams: {}
} satisfies Partial<ImageGenerationSubmitInput<PpioBag>>

const host = 'https://api.ppio.com'

interface Case {
  name: string
  endpoint: string
  input: ImageGenerationSubmitInput<PpioBag> & { modelDescriptor: ImageTransportDescriptor }
  schema: z.ZodTypeAny
}

function fixture(opts: {
  name: string
  id: string
  endpoint: string
  size?: string
  seed?: number
  files?: ImageGenerationSubmitInput<PpioBag>['files']
  params?: PpioBag
  schema: z.ZodTypeAny
}): Case {
  return {
    name: opts.name,
    endpoint: opts.endpoint,
    schema: opts.schema,
    input: {
      ...base,
      modelId: opts.id,
      prompt: 'a fox',
      size: opts.size,
      seed: opts.seed,
      files: opts.files,
      modelDescriptor: registryImageDescriptor('ppio', opts.id, 'generate', Boolean(opts.files?.length)),
      providerParams: { ...opts.params }
    }
  }
}

// `[1, 2, 3]` base64-encodes to `AQID`, so `fileToDataUrl` yields
// `data:image/png;base64,AQID` — the canonical attached-image path the
// painting pipeline feeds edit models via `inputImages` → `options.files`.
const editFiles = [
  { type: 'file', mediaType: 'image/png', data: new Uint8Array([1, 2, 3]) }
] satisfies ImageGenerationSubmitInput<PpioBag>['files']

const CASES: Case[] = [
  fixture({
    name: 'jimeng — width/height split + use_pre_llm + logo_info',
    id: 'jimeng-txt2img-v3.1',
    endpoint: '/v3/async/jimeng-txt2img-v3.1',
    size: '1024x1024',
    seed: 42,
    // `promptEnhancement` is the canonical key the registry declares and the only
    // spelling that survives the IPC boundary; the bag used to be read as `usePreLlm`,
    // which never arrived. Asserted as `false` on purpose — reading the wrong key
    // falls back to the `true` default, so this fixture would pass either way at `true`.
    params: { promptEnhancement: false, addWatermark: true },
    schema: z.strictObject({
      prompt: z.string(),
      use_pre_llm: z.literal(false),
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
    id: 'qwen-image-edit',
    endpoint: '/v3/async/qwen-image-edit-2509',
    seed: 5,
    files: editFiles,
    params: { outputFormat: 'png', addWatermark: false },
    schema: z.strictObject({
      prompt: z.string(),
      image: z.literal('data:image/png;base64,AQID'),
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
    id: 'seedream-4-0',
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
    id: 'seedream-4-0',
    endpoint: '/v3/seedream-4.0',
    size: '2048x2048',
    files: editFiles,
    params: { addWatermark: true },
    schema: z.strictObject({
      prompt: z.string(),
      images: z.tuple([z.literal('data:image/png;base64,AQID')]),
      size: z.string(),
      watermark: z.boolean(),
      sequential_image_generation: z.literal('disabled')
    })
  })
]

describe('PPIO request boundary', () => {
  for (const c of CASES) {
    it(`${c.name}: encodes canonical parameters for the declared endpoint`, async () => {
      const transport = createPpioTransport({
        apiKey: 'ppio-key',
        baseURL: host,
        modelDescriptor: c.input.modelDescriptor
      })
      const req = await captureImageRequest(transport, c.input)
      expect(req.url).toBe(`${host}${c.endpoint}`)
      c.schema.parse(req.body)
      expect(req.body).toMatchObject({ prompt: 'a fox' })
      if (c.input.seed !== undefined) expect(req.body).toMatchObject({ seed: c.input.seed })
    })
  }

  it('uses the injected fetch and merges provider then request headers', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ task_id: 'task-1' }), { status: 200 }))
    const globalFetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('global fetch used'))
    const injectedTransport = createPpioTransport({
      modelDescriptor: CASES[0].input.modelDescriptor,
      apiKey: 'ppio-key',
      baseURL: host,
      headers: { Authorization: 'Bearer provider', 'x-provider': 'one' },
      fetch
    })

    // Contract source: https://ppio.com/docs/models/reference-create-async-task
    // Retrieved 2026-07-27.
    await injectedTransport.submit({
      ...CASES[0].input,
      headers: { Authorization: 'Bearer request', 'x-request': 'two' }
    })

    expect(fetch).toHaveBeenCalledTimes(1)
    expect(globalFetch).not.toHaveBeenCalled()
    const requestHeaders = Object.fromEntries(new Headers(fetch.mock.calls[0][1]?.headers).entries())
    expect(requestHeaders).toMatchObject({
      authorization: 'Bearer request',
      'x-provider': 'one',
      'x-request': 'two'
    })
    globalFetch.mockRestore()
  })
})
