import type { FC, HTMLAttributes, ReactNode } from 'react'

import { cn } from '@cherrystudio/ui/lib/utils'

interface Props extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode
  narrowMode?: boolean
  withSidePadding?: boolean
}

const NarrowLayout: FC<Props> = ({ children, className, narrowMode = false, withSidePadding = false, ...props }) => {
  return (
    <div
      className={cn(
        'narrow-mode relative mx-auto w-full transition-[max-width] duration-300 ease-in-out [[data-chat-narrow-resizing="true"]_&]:transition-none',
        narrowMode ? 'active' : 'max-w-full',
        narrowMode &&
          (withSidePadding
            ? 'max-w-[calc(var(--chat-narrow-width,800px)+3rem)]'
            : 'max-w-[var(--chat-narrow-width,800px)]'),
        withSidePadding && 'box-border px-6',
        className
      )}
      {...props}>
      {children}
    </div>
  )
}

export default NarrowLayout
