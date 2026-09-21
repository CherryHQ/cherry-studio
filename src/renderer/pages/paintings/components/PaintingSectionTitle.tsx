import type { FC, ReactNode } from 'react'

import { cn } from '@renderer/utils/style'

interface Props {
  children: ReactNode
  className?: string
}

const PaintingSectionTitle: FC<Props> = ({ children, className }) => (
  <section
    className={cn(
      'mb-1.5 flex items-center justify-start gap-1 select-none',
      'text-xs tracking-wider text-muted-foreground uppercase',
      className
    )}>
    {children}
  </section>
)

export default PaintingSectionTitle
