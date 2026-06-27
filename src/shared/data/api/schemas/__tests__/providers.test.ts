import { describe, expect, it } from 'vitest'

import { CreateProviderSchema, UpdateProviderSchema } from '../providers'

const FILE_ID = '019606a0-0000-7000-8000-0000000000aa'

describe('Provider DTO logo validation', () => {
  it('accepts a preset-key logo on create', () => {
    expect(
      CreateProviderSchema.safeParse({ providerId: 'p', name: 'n', logo: { kind: 'key', key: 'icon:openai' } }).success
    ).toBe(true)
  })

  it('accepts an uploaded-file logo on create', () => {
    expect(
      CreateProviderSchema.safeParse({ providerId: 'p', name: 'n', logo: { kind: 'file', fileId: FILE_ID } }).success
    ).toBe(true)
  })

  it('rejects a bare string logo — a union variant must be chosen', () => {
    expect(
      CreateProviderSchema.safeParse({ providerId: 'p', name: 'n', logo: 'data:image/png;base64,abc' }).success
    ).toBe(false)
  })

  it('rejects setting both key and fileId at once', () => {
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

  it('accepts a clear intent on update', () => {
    expect(UpdateProviderSchema.safeParse({ logo: { kind: 'clear' } }).success).toBe(true)
  })

  it('rejects a clear intent on create (no such variant)', () => {
    expect(CreateProviderSchema.safeParse({ providerId: 'p', name: 'n', logo: { kind: 'clear' } }).success).toBe(false)
  })
})
