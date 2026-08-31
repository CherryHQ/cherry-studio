import { cn } from '@renderer/utils/style'
import type { ComponentPropsWithRef } from 'react'

export default function ComposerFloatingCapsule({ children, className, ref, ...props }: ComponentPropsWithRef<'div'>) {
  return (
    <div
      ref={ref}
      className={cn(
        'pointer-events-auto flex h-9 cursor-default items-center gap-2 rounded-full border border-border-subtle bg-popover px-3 text-popover-foreground text-sm shadow-sm outline-none transition-[border-color,box-shadow] hover:border-border focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/20 focus-visible:ring-inset',
        className
      )}
      {...props}>
      {children}
    </div>
  )
}
