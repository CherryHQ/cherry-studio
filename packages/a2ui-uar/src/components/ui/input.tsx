import { Input as InputPrimitive } from '@base-ui/react/input'

import { cn } from '../../lib/cn'

/** Vendored subset of `frontend/src/components/ui/input.tsx` — see button.tsx for why this is a local copy. */
export function Input({ className, type, ...props }: InputPrimitive.Props) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        'min-h-11 w-full min-w-0 rounded-md bg-surface px-3 py-2 text-base transition-[color,box-shadow] outline-none placeholder:text-muted-foreground focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm',
        className
      )}
      {...props}
    />
  )
}
