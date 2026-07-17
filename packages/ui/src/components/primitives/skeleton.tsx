import { cn } from '@cherrystudio/ui/lib/utils'

function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-ui="part:skeleton" className={cn('animate-pulse rounded-md bg-accent', className)} {...props} />
}

export { Skeleton }
