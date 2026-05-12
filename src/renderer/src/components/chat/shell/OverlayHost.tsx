import { ErrorBoundary } from '@renderer/components/ErrorBoundary'
import { cn } from '@renderer/utils'
import type { CSSProperties, ReactNode } from 'react'

export interface OverlayHostProps {
  children?: ReactNode
  className?: string
  style?: CSSProperties
}

export function OverlayHost({ children, className, style }: OverlayHostProps) {
  if (!children) return null

  return (
    <div className={cn('pointer-events-none absolute inset-0 z-[1000]', className)} style={style}>
      <div className="pointer-events-auto">
        <ErrorBoundary>{children}</ErrorBoundary>
      </div>
    </div>
  )
}
