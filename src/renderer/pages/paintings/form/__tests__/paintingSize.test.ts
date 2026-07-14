import { describe, expect, it } from 'vitest'

import { tabToImageGenerationMode } from '../../utils/paintingProviderMode'
import { imageGenerationToFields } from '../imageGenerationToFields'
import { resolveRatio, resolveSizeLabel } from '../paintingSize'

/** Minimal registry support declaring a single size-bearing field. */
const supportWith = (key: string, options: string[], def: string) => ({
  modes: { generate: { supports: { [key]: { type: 'enum', options, default: def } } } }
})

// The same config items the components derive internally, so the resolvers see
// the fields (including registry defaults) they would at runtime.
const fieldsFor = (support: unknown) =>
  imageGenerationToFields(support as never, { mode: tabToImageGenerationMode('generate') })

describe('resolveRatio', () => {
  it('derives the aspect ratio from a stored size', () => {
    const fields = fieldsFor(supportWith('size', ['1024x768', '1024x1024'], '1024x1024'))
    expect(resolveRatio({ size: '1024x768' }, fields)).toBe(1024 / 768)
  })

  it('derives the aspect ratio from an aspect-ratio enum', () => {
    const fields = fieldsFor(supportWith('aspectRatio', ['ASPECT_16_9'], 'ASPECT_16_9'))
    expect(resolveRatio({}, fields)).toBe(16 / 9)
  })

  // The effective size is the registry default, not stored in params, so reading
  // params alone would return null; resolveRatio must fall back to initialValue.
  it('falls back to the registry default when nothing is stored', () => {
    const fields = fieldsFor(supportWith('size', ['1024x1024'], '1024x1024'))
    expect(resolveRatio({}, fields)).toBe(1)
  })

  it('reads explicit custom dimensions', () => {
    const fields = fieldsFor(supportWith('size', ['1024x1024', 'custom'], '1024x1024'))
    expect(resolveRatio({ size: 'custom', customSize_width: 800, customSize_height: 600 }, fields)).toBe(800 / 600)
  })

  it('uses a 1:1 square when the effective size is auto', () => {
    const fields = fieldsFor(supportWith('size', ['auto', '1024x1024'], 'auto'))
    expect(resolveRatio({ size: 'auto' }, fields)).toBe(1)
  })

  it('returns null when the model declares no size field', () => {
    expect(resolveRatio({}, fieldsFor(undefined))).toBeNull()
  })
})

describe('resolveSizeLabel', () => {
  it('formats a stored pixel size', () => {
    const fields = fieldsFor(supportWith('size', ['1024x768', '1024x1024'], '1024x1024'))
    expect(resolveSizeLabel({ size: '1024x768' }, fields)).toBe('1024×768')
  })

  it('keeps auto as a label instead of collapsing it to a ratio', () => {
    const fields = fieldsFor(supportWith('size', ['auto', '1024x1024'], '1024x1024'))
    expect(resolveSizeLabel({ size: 'auto' }, fields)).toBe('auto')
  })

  it('falls back to the registry default when nothing is stored', () => {
    const fields = fieldsFor(supportWith('size', ['1024x1024'], '1024x1024'))
    expect(resolveSizeLabel({}, fields)).toBe('1024×1024')
  })

  it('reads explicit custom dimensions', () => {
    const fields = fieldsFor(supportWith('size', ['1024x1024', 'custom'], '1024x1024'))
    expect(resolveSizeLabel({ size: 'custom', customSize_width: 800, customSize_height: 600 }, fields)).toBe('800×600')
  })

  it('returns undefined for a custom size with no explicit dimensions yet', () => {
    const fields = fieldsFor(supportWith('size', ['1024x1024', 'custom'], '1024x1024'))
    expect(resolveSizeLabel({ size: 'custom' }, fields)).toBeUndefined()
  })

  it('returns undefined when the model declares no size field', () => {
    expect(resolveSizeLabel({}, fieldsFor(undefined))).toBeUndefined()
  })
})
