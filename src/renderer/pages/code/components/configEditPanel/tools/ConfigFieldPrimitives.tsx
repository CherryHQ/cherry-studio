import { cn } from '@renderer/utils/style'
import type { ReactNode } from 'react'

export function Field({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={cn('min-w-0 flex-1', className)}>
      <span className="mb-1 block text-[10px] text-muted-foreground/60">{label}</span>
      {children}
    </label>
  )
}

export function parseCommaList(raw: string): string[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

export function formatCommaList(value: unknown): string {
  return Array.isArray(value) ? value.filter((v) => typeof v === 'string').join(', ') : ''
}

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
