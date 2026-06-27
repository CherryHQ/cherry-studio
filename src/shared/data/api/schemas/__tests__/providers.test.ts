import { describe, expect, it } from 'vitest'

import { CreateProviderSchema, UpdateProviderSchema } from '../providers'

const FILE_ID = '019606a0-0000-7000-8000-0000000000aa'

describe('Provider DTO logo validation', () => {
  it('accepts a preset-key logo on create', () => {
    expect(
      CreateProviderSchema.safeParse({ providerId: 'p', name: 'n', logo: { kind: 'key', key: 'icon:openai' } }).success
    ).toBe(true)
  })

  it('rejects an uploaded-file logo on create — uploads go through provider.set_logo', () => {
    expect(
      CreateProviderSchema.safeParse({ providerId: 'p', name: 'n', logo: { kind: 'file', fileId: FILE_ID } }).success
    ).toBe(false)
  })

  it('rejects a bare string logo — only a preset key is allowed', () => {
    expect(
      CreateProviderSchema.safeParse({ providerId: 'p', name: 'n', logo: 'data:image/png;base64,abc' }).success
    ).toBe(false)
  })

  it('rejects extra fields on the key variant', () => {
    expect(
      CreateProviderSchema.safeParse({ providerId: 'p', name: 'n', logo: { kind: 'key', key: 'x', fileId: FILE_ID } })
        .success
    ).toBe(false)
  })

  it('rejects an empty key', () => {
    expect(CreateProviderSchema.safeParse({ providerId: 'p', name: 'n', logo: { kind: 'key', key: '' } }).success).toBe(
      false
    )
  })

  it('rejects a clear intent on create (no such variant)', () => {
    expect(CreateProviderSchema.safeParse({ providerId: 'p', name: 'n', logo: { kind: 'clear' } }).success).toBe(false)
  })

  it('rejects a logo field on update — logo edits go through provider.set_logo', () => {
    expect(UpdateProviderSchema.safeParse({ logo: { kind: 'clear' } }).success).toBe(false)
    expect(UpdateProviderSchema.safeParse({ logo: { kind: 'key', key: 'icon:openai' } }).success).toBe(false)
  })

  it('accepts a non-logo update (e.g. name)', () => {
    expect(UpdateProviderSchema.safeParse({ name: 'Renamed' }).success).toBe(true)
  })
})
