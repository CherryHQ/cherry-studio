import { cn } from '@renderer/utils'
import type { FC, ReactNode } from 'react'

interface Props {
  children: ReactNode
  className?: string
}

const PaintingSectionTitle: FC<Props> = ({ children, className }) => (
  <section
    className={cn(
      'mb-1.5 flex select-none items-center justify-start gap-1',
      'text-muted-foreground text-xs uppercase tracking-wider',
      className
    )}>
    {children}
  </section>
)

export default PaintingSectionTitle
