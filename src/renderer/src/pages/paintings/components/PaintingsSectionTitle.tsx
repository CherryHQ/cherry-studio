import { cn } from '@renderer/utils'
import type { FC, ReactNode } from 'react'

interface Props {
  children: ReactNode
  className?: string
}

const PaintingsSectionTitle: FC<Props> = ({ children, className }) => (
  <div
    className={cn(
      'mt-5 mb-2 flex select-none items-center justify-start gap-1',
      'font-medium text-muted-foreground text-xs uppercase tracking-wider',
      className
    )}>
    {children}
  </div>
)

export default PaintingsSectionTitle
