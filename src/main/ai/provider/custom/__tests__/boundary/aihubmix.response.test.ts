import type { ImageModelV3CallOptions } from '@ai-sdk/provider'
import { describe, expect, it, vi } from 'vitest'
import * as z from 'zod'

import { createAihubmixImageModel } from '../../aihubmix/aihubmixImageModel'
import { runWithResponse } from './captureRequest'

vi.mock('@renderer/i18n', () => ({ default: { t: (k: string) => k } }))
vi.mock('i18next', () => ({ default: { t: (k: string) => k } }))

/**
 * Inbound (response) boundary for the AiHubMix Ideogram branches: V_3 generate
 * parses `data[].url`; the V_1/V_2 shared path also accepts the wrapped
 * `output.b64_json[].bytesBase64` form (→ data: URLs).
 */
function opts(partial: Partial<ImageModelV3CallOptions>): ImageModelV3CallOptions {
  return {
    prompt: 'a fox',
    n: 1,
    size: undefined,
    aspectRatio: undefined,
    seed: undefined,
    providerOptions: { aihubmix: { mode: 'generate' } },
    headers: undefined,
    abortSignal: undefined,
    files: undefined,
    mask: undefined,
    ...partial
  } as ImageModelV3CallOptions
}

const config = {
  baseURL: 'https://aihubmix.com/v1',
  resolveApiKey: () => 'sk',
  headers: () => ({ Authorization: 'Bearer sk' })
}

describe('AiHubMix response boundary (Ideogram branches)', () => {
  it('V_3 generate → data[].url', async () => {
    const response = { data: [{ url: 'https://img/v3a.png' }, { url: 'https://img/v3b.png' }] }
    z.object({ data: z.array(z.object({ url: z.string() })) }).parse(response)
    const result = await runWithResponse(response, (fetch) =>
      createAihubmixImageModel('V_3', { ...config, fetch }).doGenerate(opts({}))
    )
    expect(result.images).toMatchSnapshot()
  })

  it('V_2 generate → output.b64_json[].bytesBase64 (wrapped → data: URLs)', async () => {
    const response = { output: { b64_json: [{ bytesBase64: 'QUJD' }] } }
    z.object({ output: z.object({ b64_json: z.array(z.object({ bytesBase64: z.string() })) }) }).parse(response)
    const result = await runWithResponse(response, (fetch) =>
      createAihubmixImageModel('V_2', { ...config, fetch }).doGenerate(opts({}))
    )
    expect(result.images).toMatchSnapshot()
  })
})
