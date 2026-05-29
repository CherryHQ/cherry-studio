import { describe, expect, it } from 'vitest'
import * as z from 'zod'

import type { ImageGenerationSubmitInput } from '../../imageGenerationModel'
import { createTokenFluxTransport } from '../../tokenflux/tokenfluxTransport'
import { captureImageRequest } from './captureRequest'

/**
 * TokenFlux request boundary — async submit POSTs `/v1/images/generations` with
 * `{ model, input: { prompt, ...inputParams } }`; the JSON-schema-driven
 * `inputParams` bag is spread into `input` verbatim.
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
  input: z.strictObject({
    prompt: z.string(),
    aspect_ratio: z.string(),
    num_outputs: z.number().int().positive()
  })
})

describe('TokenFlux request boundary', () => {
  const transport = createTokenFluxTransport({ apiKey: 'tf-key', baseURL: 'https://api.tokenflux.ai' })

  it('async /v1/images/generations spreads inputParams into input', async () => {
    const req = await captureImageRequest(transport, {
      ...base,
      modelId: 'black-forest-labs/flux-1.1-pro',
      prompt: 'a fox',
      providerParams: { inputParams: { aspect_ratio: '1:1', num_outputs: 1 } }
    } as ImageGenerationSubmitInput)

    expect(req.url).toBe('https://api.tokenflux.ai/v1/images/generations')
    bodySchema.parse(req.body)
    expect(req.body).toMatchSnapshot()
  })
})
