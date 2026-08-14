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
    // A stale / model-switched size is absent from the current options, so there
    // is no localized option to adopt — it formats the raw value directly
    // (exercises the `selected?.label ?? value` fallback).
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
  // The composer chips (SizeChipsField) and the prompt bar (resolveSizeLabel)
  // both localize through this same option `labelKey`, so wiring it on every
  // size-bearing key keeps the two from drifting back to the raw `auto` enum.
  it.each(['size', 'aspectRatio', 'imageResolution'])(
    'marks the %s field `auto` option with the shared localization key',
    (key) => {
      const [field] = fieldsFor(supportWith(key, ['auto', '1024x1024'], '1024x1024'))
      const autoOption = (field as { options: { value: string; labelKey?: string }[] }).options.find(
        (option) => option.value === 'auto'
      )
      expect(autoOption?.labelKey).toBe('paintings.image_size_options.auto')
    }
  )
})
