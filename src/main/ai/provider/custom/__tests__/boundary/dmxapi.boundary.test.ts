import { describe, expect, it, vi } from 'vitest'
import * as z from 'zod'

import { createDmxapiTransport } from '../../dmxapi/dmxapiTransport'
import type { ImageGenerationSubmitInput } from '../../imageGenerationModel'
import { captureImageRequest } from './captureRequest'

vi.mock('@renderer/i18n', () => ({ default: { t: (k: string) => k } }))
vi.mock('i18next', () => ({ default: { t: (k: string) => k } }))

/**
 * Request-boundary contract for the DMXAPI transport. Each fixture drives one
 * wire family; the body is checked two ways:
 *   1. zod — asserts the **contract** (required keys, types, endpoint), failing
 *      loudly if a field is dropped / mistyped / unexpectedly added (`strict`).
 *   2. snapshot — pins the exact **wire shape** so any change is reviewed.
 * Native fields (n / size / seed / files) source from `input.*`; the option
 * value reaches the body verbatim.
 */

const base = {
  n: 1,
  size: undefined,
  seed: undefined,
  files: undefined,
  mask: undefined,
  providerParams: {}
} satisfies Partial<ImageGenerationSubmitInput>

const openAiFlatBody = z.strictObject({
  model: z.string(),
  prompt: z.string(),
  n: z.number().int().positive(),
  response_format: z.literal('url'),
  size: z.string().optional()
})

const asyncFlatBody = z.strictObject({
  model: z.string(),
  prompt: z.string(),
  n: z.number().int().positive(),
  size: z.string().optional()
})

const responsesStringBody = z.strictObject({
  model: z.string(),
  input: z.string(),
  stream: z.literal(false),
  size: z.string().optional(),
  seed: z.number().optional()
})

const messagePart = z.union([z.strictObject({ text: z.string() }), z.strictObject({ image: z.string() })])
const responsesMessagesBody = z.strictObject({
  model: z.string(),
  input: z.strictObject({
    messages: z.array(z.strictObject({ role: z.literal('user'), content: z.array(messagePart) }))
  })
})

interface BoundaryCase {
  name: string
  input: ImageGenerationSubmitInput
  url: string
  schema: z.ZodTypeAny
}

const CASES: BoundaryCase[] = [
  {
    name: 'openai-flat → /v1/images/generations',
    input: { ...base, modelId: 'flux-1', prompt: 'a fox', n: 2, size: '1328x1328' },
    url: 'https://www.dmxapi.com/v1/images/generations',
    schema: openAiFlatBody
  },
  {
    name: 'async qwen-image → /v1/images/generations',
    input: { ...base, modelId: 'qwen-image', prompt: 'a fox', size: '1024x1024' },
    url: 'https://www.dmxapi.com/v1/images/generations',
    schema: asyncFlatBody
  },
  {
    name: 'doubao-seedream → /v1/responses (string input)',
    input: { ...base, modelId: 'doubao-seedream-3-0', prompt: 'a fox', size: '1024x1024', seed: 42 },
    url: 'https://www.dmxapi.com/v1/responses',
    schema: responsesStringBody
  },
  {
    name: 'wan → /v1/responses (messages + inlined file)',
    input: {
      ...base,
      modelId: 'wan2.5',
      prompt: 'a fox',
      files: [{ mediaType: 'image/png', data: new Uint8Array([1, 2, 3]) }] as ImageGenerationSubmitInput['files']
    },
    url: 'https://www.dmxapi.com/v1/responses',
    schema: responsesMessagesBody
  }
]

describe('DMXAPI request boundary', () => {
  const transport = createDmxapiTransport({ apiKey: 'token', baseURL: 'https://www.dmxapi.com' })

  for (const c of CASES) {
    it(`${c.name}: satisfies the wire contract and matches snapshot`, async () => {
      const req = await captureImageRequest(transport, c.input)
      expect(req.url).toBe(c.url)
      // zod wire-contract — throws a descriptive ZodError (failing the test) on violation
      c.schema.parse(req.body)
      expect(req.body).toMatchSnapshot()
    })
  }
})
