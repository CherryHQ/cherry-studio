import { cn } from '@renderer/utils'
import type { ThemeMode } from '@shared/data/preference/preferenceTypes'
import { ChevronDown, ChevronRight } from 'lucide-react'
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
    <div className={cn('mt-0 mb-1 w-full rounded-xs px-1.25', className)} {...rest}>
      <div className="mb-2.5 flex cursor-pointer select-none items-center border-border border-b-[0.5px] pb-3">
        <div onClick={() => setIsExpanded(!isExpanded)} className="flex flex-1 cursor-pointer items-center">
          {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          <div className="ml-1 font-medium text-sm">{title}</div>
        </div>
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
