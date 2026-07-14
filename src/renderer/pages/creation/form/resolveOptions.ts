import type { BaseConfigItem, OptionItem } from './baseConfigItem'

/**
 * Resolve a field's options — a static `OptionItem[]` or a
 * `(item, painting) => OptionItem[]` function — and localize each `labelKey`
 * into a display `label`. Shared by the select, size-chip, and icon-radio
 * field renderers so the resolve-then-localize step lives in one place.
 */
export function resolveOptions(
  item: BaseConfigItem,
  painting: Record<string, unknown>,
  translate: (key: string) => string
): OptionItem[] {
  const rawOptions = typeof item.options === 'function' ? item.options(item, painting) : (item.options ?? [])
  return rawOptions.map((option) => ({
    ...option,
    label: option.labelKey ? translate(option.labelKey) : option.label
  }))
}
