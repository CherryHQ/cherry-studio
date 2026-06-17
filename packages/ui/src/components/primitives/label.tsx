import { cn } from '@cherrystudio/ui/lib/utils'
import * as LabelPrimitive from '@radix-ui/react-label'
import * as React from 'react'

/**
 * Decorative "required field" asterisk. Standalone-usable (e.g. next to a
 * schema property name) and the single source of truth for the marker that
 * `Label` renders when `required` is set.
 */
function RequiredMark({ className, ...props }: React.ComponentProps<'span'>) {
  return (
    <span aria-hidden="true" className={cn('text-destructive', className)} {...props}>
      *
    </span>
  )
}

function Label({
  className,
  required,
  children,
  ...props
}: React.ComponentProps<typeof LabelPrimitive.Root> & { required?: boolean }) {
  return (
    <LabelPrimitive.Root
      data-slot="label"
      className={cn(
        'flex items-center gap-2 text-sm leading-none font-medium select-none group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50 peer-disabled:cursor-not-allowed peer-disabled:opacity-50',
        className
      )}
      {...props}>
      {children}
      {/* -ms-1 trims the parent's gap-2 so the asterisk sits snug against the label text */}
      {required && <RequiredMark aria-hidden="true" className="-ms-1" />}
    </LabelPrimitive.Root>
  )
}

export { Label, RequiredMark }
