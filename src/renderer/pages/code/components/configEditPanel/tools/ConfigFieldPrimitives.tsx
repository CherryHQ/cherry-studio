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
