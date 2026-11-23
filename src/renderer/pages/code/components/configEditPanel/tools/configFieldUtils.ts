import type { CliConfigWriteArgs } from '@renderer/pages/code/cliConfig'
import type { Serializable } from '@shared/types/serializable'

// oxlint-disable-next-line anti-slop/no-unknown-parameters, anti-slop/no-unsafe-dictionary-type -- User-edited CLI configuration has arbitrary nested values; only nonarray records can hold named section fields.
export function getRecord(value: unknown): Record<string, unknown> {
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- SAFETY: The non-array container is checked; field controls validate consumed values and updates preserve foreign fields.
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

type SectionFieldValue = Serializable | undefined

/**
 * Build a `(section, key, value)` updater that writes `value` into a nested
 * config section, pruning empty values and empty sections. Wrap the result in
 * `useMemo(..., [config, onChange])` at the call site for referential stability.
 */
export function makeUpdateSectionField(
  config: NonNullable<CliConfigWriteArgs['configBlob']>,
  onChange: (next: NonNullable<CliConfigWriteArgs['configBlob']>) => void
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
export function makeUpdateField(
  config: NonNullable<CliConfigWriteArgs['configBlob']>,
  onChange: (next: NonNullable<CliConfigWriteArgs['configBlob']>) => void
) {
  return (key: string, value: string | number | boolean | undefined): void => {
    const next = { ...config }

    if (value !== undefined && value !== '') next[key] = value
    else delete next[key]
    onChange(next)
  }
}
