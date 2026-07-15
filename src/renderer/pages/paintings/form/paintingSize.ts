import type { PaintingData } from '../model/types/paintingData'
import type { BaseConfigItem } from './baseConfigItem'
import { deriveChipLabel, parseRatio } from './fields/SizeChipsField'
import { resolveOptions } from './resolveOptions'

/**
 * Size-bearing canonical keys — the fields that carry image dimensions. Shared by
 * the composer's summary chips and the skeleton's aspect-ratio/size-label
 * derivation so the two never drift.
 */
export const SIZE_PREVIEW_KEYS = ['size', 'imageResolution', 'aspectRatio'] as const

/**
 * Aspect ratio of the image about to be generated, taken from the same
 * effective value the composer surfaces: `params[key] ?? item.initialValue` over
 * the model's size-bearing field. Reading `initialValue` (the registry default)
 * is what makes it correct before the user changes anything — the value shown as
 * `1024×1024` lives in the field default, not `params`. Custom sizes read the
 * explicit width × height. An `auto` size (the model picks the dimensions) falls
 * back to a 1:1 square. Returns null only with no size signal at all
 * (resolution-only tiers like `"1K"`, or a model without a size field), in which
 * case the skeleton fills the area.
 */
export function resolveRatio(params: PaintingData['params'], items: BaseConfigItem[]): number | null {
  let sawAuto = false
  for (const item of items) {
    if (!item.key || !(SIZE_PREVIEW_KEYS as readonly string[]).includes(item.key)) continue
    if (item.condition && !item.condition(params ?? {})) continue

    const value = params?.[item.key] ?? item.initialValue
    if (value === 'custom') {
      const customWidth = Number(params?.customSize_width)
      const customHeight = Number(params?.customSize_height)
      if (customWidth > 0 && customHeight > 0) return customWidth / customHeight
      continue
    }

    if (typeof value !== 'string') continue
    // `auto` lets the model choose — remember it but keep scanning in case
    // another field carries a concrete ratio to prefer.
    if (value === 'auto') {
      sawAuto = true
      continue
    }
    const dim = parseRatio(value)
    if (dim && dim.w > 0 && dim.h > 0) return dim.w / dim.h
  }

  // No concrete ratio: use a 1:1 square for `auto`, otherwise fill the area.
  return sawAuto ? 1 : null
}

/**
 * Human-readable size label for the same effective value `resolveRatio` reads
 * (`params[key] ?? item.initialValue` over the size-bearing field) — e.g.
 * `1024×1024` or (localized) `自动`. Used by the artboard's prompt bar; distinct
 * from `resolveRatio` in that it keeps `auto` as a label instead of collapsing
 * it to a 1:1 ratio. Returns undefined when the model declares no size field or
 * a custom size has no explicit dimensions yet.
 */
export function resolveSizeLabel(
  params: PaintingData['params'],
  items: BaseConfigItem[],
  translate: (key: string) => string
): string | undefined {
  for (const item of items) {
    if (!item.key || !(SIZE_PREVIEW_KEYS as readonly string[]).includes(item.key)) continue
    if (item.condition && !item.condition(params ?? {})) continue

    const value = params?.[item.key] ?? item.initialValue
    if (value === 'custom') {
      const customWidth = Number(params?.customSize_width)
      const customHeight = Number(params?.customSize_height)
      return customWidth > 0 && customHeight > 0 ? `${customWidth}×${customHeight}` : undefined
    }

    if (typeof value !== 'string' || value === '') continue
    // Localize the selected option the same way the composer's chips do
    // (`resolveOptions` maps each option's `labelKey`), so a value like `auto`
    // reads `自动` on a localized UI instead of the raw enum, then reduce it to
    // the concise chip label.
    const selected = resolveOptions(item, params ?? {}, translate).find((option) => String(option.value) === value)
    return deriveChipLabel(selected?.label ?? value, value)
  }

  return undefined
}
