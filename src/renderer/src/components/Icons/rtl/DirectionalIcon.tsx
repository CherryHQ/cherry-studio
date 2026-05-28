import { cn } from '@renderer/utils'
import * as React from 'react'

export const DirectionalIcon = ({ className, children }: { className?: string; children: React.ReactNode }) => {
  return <span className={cn('inline-flex rtl:scale-x-[-1]', className)}>{children}</span>
}
