import { describe, expect, it } from 'vitest'

import {
  isSeedream5xTargetModel,
  sanitizeSeedreamImageParams,
  validateSeedreamImageParams
} from '../seedreamImageContract'

describe('Seedream image contract', () => {
  it('targets only the verified model', () => {
    expect(isSeedream5xTargetModel('doubao-seedream-5-5')).toBe(true)
    expect(isSeedream5xTargetModel('doubao-seedream-5-0-lite')).toBe(false)
  })
  it.each(['960x960', '2140x2160', '3840x240', '240x3840'])('accepts valid dimensions %s', (size) => {
    expect(validateSeedreamImageParams({ size })).toBeUndefined()
  })
  it.each(['959x960', '2150x2160', '3856x240', '0x960', '-1x960', '1.5x960', 'Infinityx960'])(
    'rejects invalid dimensions %s',
    (size) => {
      expect(validateSeedreamImageParams({ size })).toBe('size')
    }
  )
  it.each([
    {},
    { customSize_width: 0 },
    { customSize_width: -1 },
    { customSize_width: 1.5 },
    { customSize_width: Infinity }
  ])('rejects incomplete or invalid custom dimensions', (values) => {
    expect(validateSeedreamImageParams({ imageResolution: 'custom', ...values })).toBe('size')
  })
  it('rejects conflicting sources and transparent jpeg', () => {
    expect(validateSeedreamImageParams({ imageResolution: '1K', size: '960x960' })).toBe('size')
    expect(validateSeedreamImageParams({ background: 'transparent' })).toBe('background-format')
    expect(validateSeedreamImageParams({ background: 'transparent', outputFormat: 'png' })).toBeUndefined()
    expect(validateSeedreamImageParams({ background: 'opaque', outputFormat: 'jpeg' })).toBeUndefined()
  })
  it.each([
    ['png', undefined],
    ['PNG', 'background-format'],
    ['jpeg', 'background-format'],
    ['JPEG', 'background-format'],
    ['webp', 'background-format'],
    [undefined, 'background-format']
  ])('requires exact PNG for transparent output: %s', (outputFormat, expected) => {
    expect(validateSeedreamImageParams({ background: 'transparent', outputFormat })).toBe(expected)
  })
  it('copies, strips unsafe fields, and preserves explicit watermark', () => {
    const input = {
      imageResolution: 'custom',
      customSize_width: 960,
      customSize_height: 960,
      addWatermark: false,
      numImages: 4,
      sequentialImageGeneration: 'auto',
      maxImages: 4,
      webSearch: true,
      stream: true,
      tools: []
    }
    expect(sanitizeSeedreamImageParams(input)).toEqual({
      size: '960x960',
      outputFormat: 'jpeg',
      background: 'auto',
      addWatermark: false
    })
    expect(input.numImages).toBe(4)
    expect(sanitizeSeedreamImageParams({})).toEqual({
      imageResolution: '1K',
      outputFormat: 'jpeg',
      background: 'auto',
      addWatermark: true
    })
  })
})
