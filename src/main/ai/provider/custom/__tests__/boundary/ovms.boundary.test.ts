import { describe, expect, it } from 'vitest'
import * as z from 'zod'

import type { ImageGenerationSubmitInput } from '../../imageGenerationModel'
import { createOvmsTransport } from '../../ovms/ovmsTransport'
import { captureImageRequest } from './captureRequest'

/**
 * OVMS request boundary — a single local, no-auth `/images/generations` shape
 * (note: no `/v1`). size / steps / seed fall back to defaults when absent.
 */
const base = {
  n: 1,
  size: undefined,
  seed: undefined,
  files: undefined,
  mask: undefined,
  providerParams: {}
} satisfies Partial<ImageGenerationSubmitInput>

const bodySchema = z.strictObject({
  model: z.string(),
  prompt: z.string(),
  size: z.string(),
  num_inference_steps: z.number().int().positive(),
  rng_seed: z.number().int()
})

describe('OVMS request boundary', () => {
  const transport = createOvmsTransport({ baseURL: 'http://localhost:8000' })

  it('local /images/generations (no /v1, no auth)', async () => {
    const req = await captureImageRequest(transport, {
      ...base,
      modelId: 'OpenVINO/stable-diffusion-v1-5',
      prompt: 'a fox',
      size: '768x768',
      providerParams: { numInferenceSteps: 8, seed: 123 }
    } as ImageGenerationSubmitInput)

    expect(req.url).toBe('http://localhost:8000/images/generations')
    bodySchema.parse(req.body)
    expect(req.body).toMatchSnapshot()
  })
})
