export function getRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

type SectionFieldValue = string | number | boolean | string[] | Record<string, unknown> | undefined

/**
 * Build a `(section, key, value)` updater that writes `value` into a nested
 * config section, pruning empty values and empty sections. Wrap the result in
 * `useMemo(..., [config, onChange])` at the call site for referential stability.
 */
export function makeUpdateSectionField(
  config: Record<string, unknown>,
  onChange: (next: Record<string, unknown>) => void
) {
  return (section: string, key: string, value: SectionFieldValue): void => {
    const next = { ...config }
    const sectionValue = { ...getRecord(next[section]) }
    if (value !== undefined && value !== '') sectionValue[key] = value
    else delete sectionValue[key]
    if (Object.keys(sectionValue).length > 0) next[section] = sectionValue
    else delete next[section]
    onChange(next)
  }
}

/**
 * Build a `(key, value)` updater that writes `value` into a top-level config
 * field, pruning empty values. Wrap in `useMemo(..., [config, onChange])`.
 */
export function makeUpdateField(config: Record<string, unknown>, onChange: (next: Record<string, unknown>) => void) {
  return (key: string, value: string | number | boolean | undefined): void => {
    const next = { ...config }
    if (value !== undefined && value !== '') next[key] = value
    else delete next[key]
    onChange(next)
  }
}
