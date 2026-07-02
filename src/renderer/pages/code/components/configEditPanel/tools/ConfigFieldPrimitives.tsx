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
