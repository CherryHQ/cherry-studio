import { cn } from '@renderer/utils'
import type { ReactNode } from 'react'

import { DirectionalIcon } from './DirectionalIcon'

type Props = {
  children: ReactNode
  directional?: boolean
  className?: string
}

export const Icon = ({ children, directional = false, className }: Props) => {
  if (directional) {
    return <DirectionalIcon className={className}>{children}</DirectionalIcon>
  }

  return <span className={cn('inline-flex', className)}>{children}</span>
}
