import { cn } from '@cherrystudio/ui/lib/utils'
import { lightbulbVariants } from '@renderer/utils/motionVariants'
import { Brain, ChevronDown } from 'lucide-react'
import { motion } from 'motion/react'
import React from 'react'

interface Props {
  isThinking: boolean
  thinkingTimeText: React.ReactNode
  expanded: boolean
  copyButton?: React.ReactNode
}

const ThinkingEffect: React.FC<Props> = ({ isThinking, thinkingTimeText, expanded, copyButton }) => {
  return (
    <div
      className={cn(
        'pointer-events-none relative flex min-h-9 w-full select-none items-center gap-2 overflow-hidden rounded-lg py-1 text-foreground-secondary text-sm'
      )}>
      <div className="flex h-6 w-4 shrink-0 items-center justify-start text-foreground-muted transition-colors duration-150 group-hover/thought:text-foreground-secondary">
        <motion.div variants={lightbulbVariants} animate={isThinking ? 'active' : 'idle'} initial="idle">
          <Brain size={15} strokeWidth={2} />
        </motion.div>
      </div>

      <div className="flex min-w-0 flex-1 items-center">
        <div className="shrink-0 font-normal text-foreground-secondary text-sm leading-6 transition-colors duration-150 group-hover/thought:text-foreground">
          {thinkingTimeText}
        </div>
        {copyButton && (
          <div className="pointer-events-auto opacity-0 transition-opacity duration-150 group-hover/thought:opacity-100">
            {copyButton}
          </div>
        )}
      </div>

      <div
        className={cn(
          'flex h-6 w-6 shrink-0 items-center justify-center text-foreground-muted opacity-0 transition-all duration-150 group-hover/thought:opacity-100',
          expanded && 'rotate-180'
        )}>
        <ChevronDown size={15} strokeWidth={1.8} />
      </div>
    </div>
  )
}

export default ThinkingEffect
