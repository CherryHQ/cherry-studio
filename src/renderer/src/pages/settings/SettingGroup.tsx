import { cn } from '@renderer/utils'
import type { ThemeMode } from '@shared/data/preference/preferenceTypes'
import { ChevronRight } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useState } from 'react'

export const CollapsibleSettingGroup = ({
  title,
  children,
  defaultExpanded = true,
  extra,
  className,
  ...rest
}: React.ComponentPropsWithoutRef<'div'> & {
  title: React.ReactNode
  defaultExpanded?: boolean
  extra?: React.ReactNode
  theme?: ThemeMode
}) => {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded)

  return (
    <div
      className={cn('mt-0 w-full rounded-lg px-1.25 [&:first-child>div:first-child]:mt-0', className)}
      data-state={isExpanded ? 'open' : 'closed'}
      {...rest}>
      <div className="my-1.5 flex items-center gap-1">
        <button
          type="button"
          aria-expanded={isExpanded}
          data-state={isExpanded ? 'open' : 'closed'}
          onClick={() => setIsExpanded(!isExpanded)}
          className={cn(
            "inline-flex h-9 w-full shrink-0 items-center justify-start gap-1.5 whitespace-nowrap rounded-[var(--radius-lg)] px-1.5 py-1.5 text-left font-normal text-muted-foreground text-xs tracking-normal outline-none transition-all hover:bg-accent hover:text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-30 has-[>svg]:px-3 aria-invalid:border-destructive-border aria-invalid:ring-destructive-ring data-[state=open]:text-foreground dark:aria-invalid:ring-destructive-ring dark:hover:bg-accent/50 [&_svg:not([class*='size-'])]:size-4 [&_svg]:pointer-events-none [&_svg]:shrink-0"
          )}>
          <ChevronRight className={cn('text-current transition-transform', isExpanded && 'rotate-90')} />
          <span className="min-w-0 truncate">{title}</span>
        </button>
        {extra && <div>{extra}</div>}
      </div>
      <AnimatePresence initial={false}>
        {isExpanded && (
          <motion.div
            className="overflow-hidden"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}>
            <div>{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
