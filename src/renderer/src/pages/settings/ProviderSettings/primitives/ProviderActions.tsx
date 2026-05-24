import { cn } from '@renderer/utils'
import type { ReactNode } from 'react'

interface ProviderActionsProps {
  children: ReactNode
  className?: string
}

export default function ProviderActions({ children, className }: ProviderActionsProps) {
  return <div className={cn('flex items-center gap-2', className)}>{children}</div>
}
