import type { OptionItem, OptionsConfigItem } from './baseConfigItem'
import { catalogValueOr, controlValue } from './fieldValue'

/**
 * Resolve a field's options — a static `OptionItem[]` or a
 * `(item, painting) => OptionItem[]` function — and localize each `labelKey`
 * into a display `label`. Shared by the select, size-chip, and icon-radio
 * field renderers so the resolve-then-localize step lives in one place.
 */
export function resolveOptions(
  item: OptionsConfigItem,
  painting: Record<string, unknown>,
  translate: (key: string) => string
): OptionItem[] {
  const rawOptions = typeof item.options === 'function' ? item.options(item, painting) : (item.options ?? [])
  return rawOptions.map((option) => ({
    ...option,
    label: option.labelKey ? translate(option.labelKey) : option.label
  }))
}

/** Resolve a persisted option value or fall back to the typed registry default. */
export function resolveOptionValue(
  item: OptionsConfigItem,
  value: unknown,
  painting: Record<string, unknown>,
  translate: (key: string) => string
): string | number | undefined {
  const candidate = catalogValueOr(item.key, value, item.initialValue)
  const normalized = controlValue(candidate)
  const match = resolveOptions(item, painting, translate).find(
    (option) => normalized !== '' && controlValue(option.value) === normalized
  )
  return match?.value ?? item.initialValue
}
