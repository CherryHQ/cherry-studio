import { describe, expect, it } from 'vitest'

import { MAX_TRANSLATE_IMAGE_BYTES } from '@shared/utils/constants'

import { translateRequestSchemas } from '../translate'

describe('translate.open input schema', () => {
  const baseInput = {
    streamId: 'translate:test',
    text: 'hello',
    targetLangCode: 'en-us'
  }

  it('accepts nonempty image bytes up to the size limit', () => {
    expect(
      translateRequestSchemas['translate.open'].input.safeParse({
        ...baseInput,
        image: { data: new Uint8Array([1]), filename: 'shot.png' }
      }).success
    ).toBe(true)
    expect(
      translateRequestSchemas['translate.open'].input.safeParse({
        ...baseInput,
        image: { data: new Uint8Array(MAX_TRANSLATE_IMAGE_BYTES), filename: 'shot.png' }
      }).success
    ).toBe(true)
  })

  it.each([0, MAX_TRANSLATE_IMAGE_BYTES + 1])('rejects image byte length %s', (length) => {
    expect(
      translateRequestSchemas['translate.open'].input.safeParse({
        ...baseInput,
        image: { data: new Uint8Array(length), filename: 'shot.png' }
      }).success
    ).toBe(false)
  })

  it('rejects image filenames containing path separators', () => {
    expect(
      translateRequestSchemas['translate.open'].input.safeParse({
        ...baseInput,
        image: { data: new Uint8Array([1]), filename: '../shot.png' }
      }).success
    ).toBe(false)
  })

  it.each([{ imagePath: '/tmp/shot.png' }, { imageEntryId: '019606a0-0000-7000-8000-000000000058' }])(
    'rejects legacy image references',
    (legacyInput) => {
      expect(translateRequestSchemas['translate.open'].input.safeParse({ ...baseInput, ...legacyInput }).success).toBe(
        false
      )
    }
  )
})
