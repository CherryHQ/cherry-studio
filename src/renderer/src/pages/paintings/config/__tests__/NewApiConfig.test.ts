import { describe, expect, it } from 'vitest'

import { getNewApiModelConfig, isSupportedNewApiModel } from '../NewApiConfig'

describe('NewApiConfig', () => {
  it('treats gpt-image-2 aliases as supported NewAPI image models', () => {
    expect(isSupportedNewApiModel('gpt-image-2')).toBe(true)
    expect(isSupportedNewApiModel('gpt-image-2-c')).toBe(true)
  })

  it('exposes 2560x1440 for gpt-image-2 family aliases', () => {
    const imageSizes = getNewApiModelConfig('gpt-image-2-c').imageSizes.map((option) => option.value)

    expect(imageSizes).toContain('2560x1440')
  })

  it('keeps gpt-image-1 on its documented fixed-size set', () => {
    const imageSizes = getNewApiModelConfig('gpt-image-1').imageSizes.map((option) => option.value)

    expect(imageSizes).not.toContain('2560x1440')
  })
})
