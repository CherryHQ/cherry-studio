import { cn } from '@cherrystudio/ui/lib/utils'
import type { ComponentProps, ReactNode } from 'react'

type ToolbarDensity = 'compact' | 'default'
type ToolbarVariant = 'plain' | 'surface'

export interface ToolbarProps extends ComponentProps<'div'> {
  density?: ToolbarDensity
  leading?: ReactNode
  trailing?: ReactNode
  variant?: ToolbarVariant
}

const densityClassNames: Record<ToolbarDensity, string> = {
  compact: 'min-h-8 px-2 py-1',
  default: 'min-h-10 px-3 py-2'
}

const variantClassNames: Record<ToolbarVariant, string> = {
  plain: '',
  surface: 'border-border/60 border-b bg-background'
}

export function Toolbar({
  children,
  className,
  density = 'default',
  leading,
  role,
  trailing,
  variant = 'plain',
  ...props
}: ToolbarProps) {
  return (
    <div
      data-slot="chat-toolbar"
      role={role ?? 'toolbar'}
      className={cn(
        'flex min-w-0 shrink-0 items-center justify-between gap-2',
        densityClassNames[density],
        variantClassNames[variant],
        className
      )}
      {...props}>
      <div data-slot="chat-toolbar-leading" className="flex min-w-0 flex-1 items-center gap-2">
        {leading}
        {children}
      </div>
      {trailing && (
        <div data-slot="chat-toolbar-trailing" className="flex shrink-0 items-center gap-1">
          {trailing}
        </div>
      )}
    </div>
  )
}
