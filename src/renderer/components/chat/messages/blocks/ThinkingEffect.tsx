import { cn } from '@cherrystudio/ui/lib/utils'
import { lightbulbVariants } from '@renderer/utils/motionVariants'
import { Brain, ChevronDown } from 'lucide-react'
import { motion } from 'motion/react'
import React from 'react'

interface Props {
  isThinking: boolean
  thinkingTimeText: React.ReactNode
  expanded: boolean
}

const ThinkingEffect: React.FC<Props> = ({ isThinking, thinkingTimeText, expanded }) => {
  return (
    <div
      className={cn(
        'pointer-events-none relative flex min-h-7 w-full select-none items-center gap-2 overflow-hidden rounded-lg py-0.5 text-[13px] text-foreground-secondary'
      )}>
      <div className="relative flex h-5 w-4 shrink-0 items-center justify-start text-foreground-muted">
        <motion.div variants={lightbulbVariants} animate={isThinking ? 'active' : 'idle'} initial="idle">
          <Brain size={14} strokeWidth={2} />
        </motion.div>
      </div>

      <div className="flex min-w-0 flex-1 items-center">
        <div className="shrink-0 font-normal text-[13px] text-foreground-secondary leading-5">{thinkingTimeText}</div>
      </div>
      <ChevronDown
        aria-hidden="true"
        size={16}
        className={cn(
          'ml-auto shrink-0 text-foreground-muted opacity-70 transition-transform duration-200',
          expanded && 'rotate-180'
        )}
      />
    </div>
  )
}

export default ThinkingEffect
