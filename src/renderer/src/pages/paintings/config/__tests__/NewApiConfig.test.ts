import { describe, expect, it } from 'vitest'

import {
  getNewApiBaseModelName,
  getNewApiModelConfig,
  isSupportedNewApiModel,
  normalizeGptImage2CustomDimension,
  normalizeGptImage2CustomSize,
  resolveNewApiOptionValue,
  validateGptImage2CustomSize
} from '../NewApiConfig'

describe('NewApi model config resolution', () => {
  it('resolves provider-prefixed model ids', () => {
    expect(getNewApiBaseModelName('openai/gpt-image-2')).toBe('gpt-image-2')
    expect(getNewApiModelConfig('openai/gpt-image-2')?.name).toBe('gpt-image-2')
    expect(isSupportedNewApiModel('openai/gpt-image-2')).toBe(true)
  })

  it('keeps bare model ids working', () => {
    expect(getNewApiModelConfig('gpt-image-1')?.name).toBe('gpt-image-1')
    expect(isSupportedNewApiModel('gpt-image-1')).toBe(true)
  })

  it('falls back invalid option values to the first supported option', () => {
    expect(resolveNewApiOptionValue(['auto', '1024x1024'], '512x512')).toBe('auto')
    expect(resolveNewApiOptionValue(['gpt-image-2'], 'openai/gpt-image-1')).toBe('gpt-image-2')
    expect(resolveNewApiOptionValue([], 'gpt-image-2')).toBeUndefined()
  })
})

describe('validateGptImage2CustomSize', () => {
  it('normalizes custom dimensions to valid step and side bounds', () => {
    expect(normalizeGptImage2CustomDimension()).toBeUndefined()
    expect(normalizeGptImage2CustomDimension(1)).toBe(16)
    expect(normalizeGptImage2CustomDimension(1537)).toBe(1536)
    expect(normalizeGptImage2CustomDimension(3856)).toBe(3840)
  })

  it('normalizes custom sizes to satisfy ratio and pixel constraints', () => {
    expect(normalizeGptImage2CustomSize(3000, 500, 'width')).toEqual({ width: 3008, height: 1008 })
    expect(normalizeGptImage2CustomSize(500, 3000, 'height')).toEqual({ width: 1008, height: 3008 })
    expect(normalizeGptImage2CustomSize(512, 512, 'width')).toEqual({ width: 512, height: 1280 })
    expect(normalizeGptImage2CustomSize(3840, 3840, 'width')).toEqual({ width: 3840, height: 2160 })
  })

  it('accepts valid custom sizes', () => {
    expect(validateGptImage2CustomSize(1536, 864)).toBeNull()
    expect(validateGptImage2CustomSize(3840, 2160)).toBeNull()
  })

  it('requires both width and height', () => {
    expect(validateGptImage2CustomSize()).toBe('paintings.gpt_image_custom_size_required')
    expect(validateGptImage2CustomSize(1536)).toBe('paintings.gpt_image_custom_size_required')
  })

  it('rejects dimensions greater than the single-side limit', () => {
    expect(validateGptImage2CustomSize(3856, 2160)).toBe('paintings.gpt_image_custom_size_range')
  })

  it('rejects dimensions that are not divisible by 16', () => {
    expect(validateGptImage2CustomSize(1537, 864)).toBe('paintings.gpt_image_custom_size_divisible')
  })

  it('rejects aspect ratios outside 1:3 to 3:1', () => {
    expect(validateGptImage2CustomSize(512, 1552)).toBe('paintings.gpt_image_custom_size_ratio')
    expect(validateGptImage2CustomSize(1552, 512)).toBe('paintings.gpt_image_custom_size_ratio')
  })

  it('rejects total pixels outside the supported range', () => {
    expect(validateGptImage2CustomSize(512, 512)).toBe('paintings.gpt_image_custom_size_pixels')
    expect(validateGptImage2CustomSize(3840, 2176)).toBe('paintings.gpt_image_custom_size_pixels')
  })
})
