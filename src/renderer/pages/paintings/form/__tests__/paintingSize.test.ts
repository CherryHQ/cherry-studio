import type { ImageGenerationSupport } from '@shared/data/types/model'
import { describe, expect, it } from 'vitest'

import { paintingOperation } from '../../utils/paintingProviderMode'
import { isOptionsConfigItem } from '../baseConfigItem'
import { imageGenerationToFields } from '../imageGenerationToFields'
import { resolveRatio, resolveSizeLabel } from '../paintingSize'

/** Minimal registry support declaring a single size-bearing field. */
const supportWith = (
  key: keyof ImageGenerationSupport['supports'],
  options: string[],
  def: string
): ImageGenerationSupport => ({
  supports: { [key]: { type: 'enum', options, default: def } },
  inputs: {
    images: { min: 0, max: { kind: 'unknown' } },
    prompt: 'required',
    mask: 'unknown',
    mediaTypes: { kind: 'unknown' }
  }
})

// The same config items the components derive internally, so the resolvers see
// the fields (including registry defaults) they would at runtime.
const fieldsFor = (support: ImageGenerationSupport | undefined) =>
  imageGenerationToFields(support, { operation: paintingOperation('generate') })

describe('resolveRatio', () => {
  it('derives the aspect ratio from a stored size', () => {
    const fields = fieldsFor(supportWith('size', ['1024x768', '1024x1024'], '1024x1024'))
    expect(resolveRatio({ size: '1024x768' }, fields)).toBe(1024 / 768)
  })

  it('derives the aspect ratio from an aspect-ratio enum', () => {
    const fields = fieldsFor(supportWith('aspectRatio', ['16:9'], '16:9'))
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
  // Stand-in for i18next `t`: localizes the shared size `auto` key, echoes any
  // other key (there are none for literal size values). Mirrors how the real
  // hook passes `t` so chips and the prompt bar localize identically.
  const translate = (key: string) => (key === 'paintings.image_size_options.auto' ? '自动' : key)

  it('formats a stored pixel size', () => {
    const fields = fieldsFor(supportWith('size', ['1024x768', '1024x1024'], '1024x1024'))
    expect(resolveSizeLabel({ size: '1024x768' }, fields, translate)).toBe('1024×768')
  })

  it('localizes auto via the shared option label instead of surfacing the raw enum', () => {
    const fields = fieldsFor(supportWith('size', ['auto', '1024x1024'], '1024x1024'))
    expect(resolveSizeLabel({ size: 'auto' }, fields, translate)).toBe('自动')
  })

  it('formats a stored size that is no longer among the field options', () => {
    // Model switching must not hide the user's currently selected dimensions.
    const fields = fieldsFor(supportWith('size', ['1024x1024'], '1024x1024'))
    expect(resolveSizeLabel({ size: '2048x2048' }, fields, translate)).toBe('2048×2048')
  })

  it('falls back to the registry default when nothing is stored', () => {
    const fields = fieldsFor(supportWith('size', ['1024x1024'], '1024x1024'))
    expect(resolveSizeLabel({}, fields, translate)).toBe('1024×1024')
  })

  it('reads explicit custom dimensions', () => {
    const fields = fieldsFor(supportWith('size', ['1024x1024', 'custom'], '1024x1024'))
    expect(resolveSizeLabel({ size: 'custom', customSize_width: 800, customSize_height: 600 }, fields, translate)).toBe(
      '800×600'
    )
  })

  it('returns undefined for a custom size with no explicit dimensions yet', () => {
    const fields = fieldsFor(supportWith('size', ['1024x1024', 'custom'], '1024x1024'))
    expect(resolveSizeLabel({ size: 'custom' }, fields, translate)).toBeUndefined()
  })

  it('returns undefined when the model declares no size field', () => {
    expect(resolveSizeLabel({}, fieldsFor(undefined), translate)).toBeUndefined()
  })
})

describe('size option label consistency', () => {
  // Chips and the prompt bar must display the same localized auto choice.
  it.each([
    ['size', '1024x1024'],
    ['aspectRatio', '16:9'],
    ['imageResolution', '2K']
  ] as const)('marks the %s field `auto` option with the shared localization key', (key, value) => {
    const [field] = fieldsFor(supportWith(key, ['auto', value], value))
    if (!isOptionsConfigItem(field) || !Array.isArray(field.options)) throw new Error('Missing size options')
    const autoOption = field.options.find((option) => option.value === 'auto')
    expect(autoOption?.labelKey).toBe('paintings.image_size_options.auto')
  })
})
