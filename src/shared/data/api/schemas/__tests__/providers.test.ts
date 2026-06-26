import { describe, expect, it } from 'vitest'

import { CreateProviderSchema, UpdateProviderSchema } from '../providers'

const LOGO_CAP = 512 * 1024

describe('Provider DTO logo validation', () => {
  it('accepts a logo within the size cap on create', () => {
    expect(
      CreateProviderSchema.safeParse({ providerId: 'p', name: 'n', logo: 'data:image/png;base64,abc' }).success
    ).toBe(true)
  })

  it('rejects a logo over the size cap on create', () => {
    const tooBig = 'a'.repeat(LOGO_CAP + 1)
    expect(CreateProviderSchema.safeParse({ providerId: 'p', name: 'n', logo: tooBig }).success).toBe(false)
  })

  it('rejects an empty-string logo on create (min length 1)', () => {
    expect(CreateProviderSchema.safeParse({ providerId: 'p', name: 'n', logo: '' }).success).toBe(false)
  })

  it('accepts null logo on update (clear signal)', () => {
    expect(UpdateProviderSchema.safeParse({ logo: null }).success).toBe(true)
  })

  it('rejects an empty-string logo on update so null is the sole clear signal', () => {
    expect(UpdateProviderSchema.safeParse({ logo: '' }).success).toBe(false)
  })

  it('rejects a logo over the size cap on update', () => {
    expect(UpdateProviderSchema.safeParse({ logo: 'a'.repeat(LOGO_CAP + 1) }).success).toBe(false)
  })
})
