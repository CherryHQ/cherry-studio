import { describe, expect, it, vi } from 'vitest'
import * as z from 'zod'

import { createDmxapiTransport } from '../../dmxapi/dmxapiTransport'
import type { ImageGenerationSubmitInput } from '../../imageGenerationModel'
import { submitWithResponse } from './captureRequest'

vi.mock('@renderer/i18n', () => ({ default: { t: (k: string) => k } }))
vi.mock('i18next', () => ({ default: { t: (k: string) => k } }))

/**
 * Inbound (response) boundary for DMXAPI. Each fixture is a representative
 * vendor response; the zod schema documents the shape our parser depends on
 * (a real capture that drifts from it fails here), and the snapshot pins the
 * extracted image URLs. Replace fixtures with real captures via
 * `scripts/capture-image-response.ts` to validate against the live API.
 */
const base = {
  n: 1,
  size: undefined,
  seed: undefined,
  files: undefined,
  mask: undefined,
  providerParams: {}
} satisfies Partial<ImageGenerationSubmitInput>

const openAiFlatResponse = z.object({
  data: z.array(z.object({ url: z.string().optional(), b64_json: z.string().optional() }))
})
const responsesApiResponse = z.object({
  output: z.array(
    z.object({ content: z.array(z.object({ text: z.string().optional(), image: z.string().optional() })) })
  )
})
const asyncResponse = z.object({
  extra: z.object({ output: z.object({ results: z.array(z.object({ url: z.string() })) }) })
})

interface Case {
  name: string
  modelId: string
  response: unknown
  schema: z.ZodTypeAny
}

const CASES: Case[] = [
  {
    name: 'openai-flat → data[].url / b64_json',
    modelId: 'flux-1',
    response: { data: [{ url: 'https://img/a.png' }, { b64_json: 'QUJD' }] },
    schema: openAiFlatResponse
  },
  {
    name: 'responses-string (doubao) → markdown URLs in output[].content[].text',
    modelId: 'doubao-seedream-3-0',
    response: { output: [{ content: [{ text: 'here ![](https://img/seed.png)' }] }] },
    schema: responsesApiResponse
  },
  {
    name: 'responses-messages (wan) → output[].content[].image',
    modelId: 'wan2.5',
    response: { output: [{ content: [{ image: 'https://img/w.png' }] }] },
    schema: responsesApiResponse
  },
  {
    name: 'async qwen-image → extra.output.results[].url',
    modelId: 'qwen-image',
    response: { extra: { output: { results: [{ url: 'https://img/q1.png' }, { url: 'https://img/q2.png' }] } } },
    schema: asyncResponse
  }
]

describe('DMXAPI response boundary', () => {
  const transport = createDmxapiTransport({ apiKey: 'token', baseURL: 'https://www.dmxapi.com' })

  for (const c of CASES) {
    it(`${c.name}: matches the inbound contract and parses to snapshot`, async () => {
      c.schema.parse(c.response)
      const result = await submitWithResponse(
        transport,
        { ...base, modelId: c.modelId, prompt: 'a fox' } as ImageGenerationSubmitInput,
        c.response
      )
      expect(result.imageUrls).toMatchSnapshot()
    })
  }
})
