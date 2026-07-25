import type { ImageModelV3File } from '@ai-sdk/provider'
import { describe, expect, it, vi } from 'vitest'

import { createDashScopeTransport } from '../../dashscope/dashscopeTransport'
import { createDmxapiTransport } from '../../dmxapi/dmxapiTransport'
import type { ImageGenerationSubmitInput, ImageGenerationTransport } from '../../imageGenerationModel'
import { createModelscopeTransport } from '../../modelscope/modelscopeTransport'
import { createOllamaTransport } from '../../ollama/ollamaTransport'
import { createOvmsTransport } from '../../ovms/ovmsTransport'
import { createPpioTransport } from '../../ppio/ppioTransport'
import { buildTokenhubTransport } from '../../tokenhub/tokenhubTransport'
import { captureImageRequest } from './captureRequest'

vi.mock('@main/i18n', () => ({ t: (key: string) => key }))

/**
 * `ImageGenerationTransport.supportsInput` is a hand-written mirror of each transport's
 * body builders, so it can drift the moment someone adds a files-reading branch without
 * updating it — and a wrong declaration is worse than none, because the caller then
 * stays quiet about a dropped reference image.
 *
 * This pins the two together behaviourally: every model below is driven through the
 * real `submit()` with a reference image and a mask attached, and the captured request
 * body must contain the image **iff** the transport declared `files: true` (same for
 * `mask`). Neither side can move alone.
 */

const REFERENCE_IMAGE: ImageModelV3File = { type: 'file', mediaType: 'image/png', data: 'aGVsbG8=' }
const MASK_IMAGE: ImageModelV3File = { type: 'file', mediaType: 'image/png', data: 'bWFzaw==' }

/** The base64 payloads above, as they appear once serialised into a body. */
const IMAGE_MARKER = 'aGVsbG8='
const MASK_MARKER = 'bWFzaw=='

function submitInput(overrides: Partial<ImageGenerationSubmitInput>): ImageGenerationSubmitInput {
  return {
    modelId: 'unused',
    prompt: 'a cat',
    n: 1,
    size: undefined,
    seed: undefined,
    files: [REFERENCE_IMAGE],
    mask: MASK_IMAGE,
    providerParams: {},
    ...overrides
  }
}

interface Case {
  transport: ImageGenerationTransport
  /** Label only. */
  vendor: string
  modelId: string
  /** Transports that dispatch on the descriptor need one; those that don't ignore it. */
  descriptor?: ImageGenerationSubmitInput['modelDescriptor']
}

const settings = { apiKey: 'sk-test', baseURL: 'https://example.invalid' }

const descriptorFor = (id: string, mode?: 'generate' | 'edit') => ({
  id,
  endpoint: '/v1/images',
  ...(mode && { mode })
})

const cases: Case[] = [
  // PPIO — files only for the Qwen edit models, and for Seedream only in edit mode.
  ...(['qwen-image-edit', 'qwen-image-edit-2509'] as const).map((id) => ({
    transport: createPpioTransport(settings),
    vendor: 'ppio',
    modelId: id,
    descriptor: descriptorFor(id)
  })),
  ...(['seedream-4.0', 'seedream-4.5', 'seedream-5.0-lite'] as const).flatMap((id) =>
    (['generate', 'edit'] as const).map((mode) => ({
      transport: createPpioTransport(settings),
      vendor: 'ppio',
      modelId: id,
      descriptor: descriptorFor(id, mode)
    }))
  ),
  ...(['jimeng-txt2img-v3.0', 'hunyuan-image-3', 'glm-image', 'z-image-turbo'] as const).map((id) => ({
    transport: createPpioTransport(settings),
    vendor: 'ppio',
    modelId: id,
    descriptor: descriptorFor(id)
  })),

  // DashScope — the reference-image families, the text-to-image family that drops them,
  // and the single model in the whole image path that has a mask slot.
  ...(
    [
      'qwen-image-edit',
      'wan2.6-image',
      'wanx-v1',
      'wan2.5-i2i-preview',
      'qwen-mt-image',
      'wanx2.1-imageedit',
      'qwen-image',
      'wanx2.1-t2i-turbo'
    ] as const
  ).map((id) => ({
    transport: createDashScopeTransport({ apiKey: 'sk-test', imageBaseURL: 'https://example.invalid' }),
    vendor: 'dashscope',
    modelId: id,
    descriptor: descriptorFor(id)
  })),

  // DMXAPI — only the `wan\d` (responses-messages) family carries images.
  ...(['wan2.6-t2i', 'doubao-seedream-4-0', 'qwen-image', 'gpt-image-1'] as const).map((id) => ({
    transport: createDmxapiTransport(settings),
    vendor: 'dmxapi',
    modelId: id
  })),

  { transport: createModelscopeTransport(settings), vendor: 'modelscope', modelId: 'MusePublic/FLUX.1-Kontext-Dev' },
  {
    transport: buildTokenhubTransport(settings),
    vendor: 'tokenhub',
    modelId: 'hy-image-v3.0',
    descriptor: descriptorFor('hy-image-v3.0')
  },
  { transport: createOvmsTransport({ baseURL: 'https://example.invalid' }), vendor: 'ovms', modelId: 'flux-schnell' },
  {
    transport: createOllamaTransport({ baseURL: 'https://example.invalid' }),
    vendor: 'ollama',
    modelId: 'x/z-image-turbo'
  }
]

describe('supportsInput matches what submit() actually puts on the wire', () => {
  it.each(cases)('$vendor / $modelId ($descriptor.mode)', async ({ transport, modelId, descriptor }) => {
    const input = submitInput({ modelId, modelDescriptor: descriptor })

    const declared = transport.supportsInput?.(input)
    expect(declared, 'every transport must declare its input support').toBeDefined()

    const request = await captureImageRequest(transport, input)
    const serialised = JSON.stringify(request.body)

    expect(serialised.includes(IMAGE_MARKER), `files declared ${declared?.files}, body ${request.url}`).toBe(
      declared?.files
    )
    expect(serialised.includes(MASK_MARKER), `mask declared ${declared?.mask}`).toBe(declared?.mask)
  })
})
