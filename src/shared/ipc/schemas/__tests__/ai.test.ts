import { describe, expect, it } from 'vitest'

import { aiRequestSchemas } from '../ai'

// The AI IPC boundary validates `uniqueModelId` with the strict `UniqueModelIdSchema`
// (`providerId::modelId`, separator at a real position, both parts well-formed), so a
// malformed id is rejected here instead of penetrating to `parseUniqueModelId` and
// throwing deeper in the routing code.
describe('ai IPC schemas — uniqueModelId validation', () => {
  const genText = aiRequestSchemas['ai.generate_text'].input
  const genImage = aiRequestSchemas['ai.generate_image'].input

  it('accepts a well-formed providerId::modelId (shared aiBaseRequestShape)', () => {
    expect(genText.safeParse({ uniqueModelId: 'openai::gpt-4o', prompt: 'hi' }).success).toBe(true)
  })

  it('rejects a malformed uniqueModelId (missing/leading separator, empty part, non-string)', () => {
    for (const uniqueModelId of ['no-separator', '::gpt-4o', 'openai::', 42]) {
      expect(genText.safeParse({ uniqueModelId, prompt: 'hi' }).success).toBe(false)
    }
  })

  it('still allows uniqueModelId to be omitted (optional)', () => {
    expect(genText.safeParse({ prompt: 'hi' }).success).toBe(true)
  })

  it('validates the nested payload uniqueModelId for ai.generate_image', () => {
    const input = (uniqueModelId: string) => ({
      requestId: 'r1',
      payload: { uniqueModelId, prompt: 'a fox', paramValues: {} }
    })
    expect(genImage.safeParse(input('openai::gpt-image')).success).toBe(true)
    expect(genImage.safeParse(input('bad-id')).success).toBe(false)
  })
})

// The video payload mirrors the image one: a canonical `paramValues` bag validated
// and coerced by the catalog `videoParamsSchema` at the boundary — no loose scalar
// fields, no untyped `providerOptions` record.
describe('ai IPC schemas — ai.generate_video payload', () => {
  const genVideo = aiRequestSchemas['ai.generate_video'].input

  const input = (paramValues: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
    requestId: 'r1',
    payload: { uniqueModelId: 'google::veo-3.1-generate', prompt: 'a cat', paramValues, ...extra }
  })

  it('coerces canonical value types at the boundary (duration/seed string → number)', () => {
    const parsed = genVideo.parse(input({ duration: '5', seed: '42', negativePrompt: 'blur' }))
    expect(parsed.payload.paramValues).toEqual({ duration: 5, seed: 42, negativePrompt: 'blur' })
  })

  it('strips non-catalog keys from the bag', () => {
    const parsed = genVideo.parse(input({ cameraFixed: true, notAParam: 'x' }))
    expect(parsed.payload.paramValues).toEqual({ cameraFixed: true })
  })

  it('rejects unknown payload fields (strict object — the old loose scalars are gone)', () => {
    expect(genVideo.safeParse(input({}, { duration: 5 })).success).toBe(false)
    expect(genVideo.safeParse(input({}, { providerOptions: {} })).success).toBe(false)
  })

  it('accepts media inputs alongside the bag', () => {
    expect(genVideo.safeParse(input({}, { firstFrame: 'data:image/png;base64,x' })).success).toBe(true)
  })
})
