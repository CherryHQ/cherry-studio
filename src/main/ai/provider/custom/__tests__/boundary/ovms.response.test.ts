import { describe, expect, it } from 'vitest'
import * as z from 'zod'

import type { ImageGenerationSubmitInput } from '../../imageGenerationModel'
import { createOvmsTransport } from '../../ovms/ovmsTransport'
import { submitWithResponse } from './captureRequest'

/** Inbound (response) boundary for OVMS — OpenAI-flat `data[].b64_json|url`. */
const base = {
  n: 1,
  size: undefined,
  seed: undefined,
  files: undefined,
  mask: undefined,
  providerParams: {}
} satisfies Partial<ImageGenerationSubmitInput>

const responseSchema = z.object({
  data: z.array(z.object({ url: z.string().optional(), b64_json: z.string().optional() }))
})

describe('OVMS response boundary', () => {
  const transport = createOvmsTransport({ baseURL: 'http://localhost:8000' })
  const input = { ...base, modelId: 'OpenVINO/stable-diffusion-v1-5', prompt: 'a fox' } as ImageGenerationSubmitInput

  it('data[].b64_json → data: URLs', async () => {
    const response = { data: [{ b64_json: 'QUJD' }] }
    responseSchema.parse(response)
    const result = await submitWithResponse(transport, input, response)
    expect(result.imageUrls).toMatchSnapshot()
  })

  it('data[].url → urls', async () => {
    const response = { data: [{ url: 'https://img/o.png' }] }
    responseSchema.parse(response)
    const result = await submitWithResponse(transport, input, response)
    expect(result.imageUrls).toMatchSnapshot()
  })
})
