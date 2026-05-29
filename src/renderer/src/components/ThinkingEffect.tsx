import { cn } from '@cherrystudio/ui/lib/utils'
import { lightbulbVariants } from '@renderer/utils/motionVariants'
import { ChevronRight, Lightbulb } from 'lucide-react'
import { motion } from 'motion/react'
import React, { useMemo } from 'react'

interface Props {
  isThinking: boolean
  thinkingTimeText: React.ReactNode
  content: string
  expanded: boolean
}

const ThinkingEffect: React.FC<Props> = ({ isThinking, thinkingTimeText, content, expanded }) => {
  const messages = useMemo(() => {
    const allLines = (content || '').split('\n')
    const newMessages = isThinking ? allLines.slice(0, -1) : allLines
    return newMessages.filter((line) => line.trim() !== '')
  }, [content, isThinking])

  const showThinking = useMemo(() => {
    return isThinking && !expanded
  }, [expanded, isThinking])

  const LINE_HEIGHT = 14

  const containerHeight = useMemo(() => {
    if (!showThinking || messages.length < 1) return 38
    return Math.min(75, Math.max(messages.length + 1, 2) * LINE_HEIGHT + 25)
  }, [showThinking, messages.length])

  return (
    <div
      className={cn(
        'pointer-events-none relative flex w-full select-none items-center overflow-hidden border-[0.5px] border-[var(--color-border)] transition-[height,border-radius] duration-150',
        expanded ? 'rounded-t-[10px]' : 'rounded-[10px]'
      )}
      style={{ height: containerHeight }}>
      <div className="relative flex h-full w-[50px] shrink-0 items-center justify-center pl-[5px] transition-[width] duration-150">
        <motion.div
          className="flex items-center justify-center"
          variants={lightbulbVariants}
          animate={isThinking ? 'active' : 'idle'}
          initial="idle">
          <Lightbulb
            size={!showThinking || messages.length < 2 ? 20 : 30}
            style={{ transition: 'width,height, 150ms' }}
          />
        </motion.div>
      </div>

      <div className="relative h-full flex-1 overflow-hidden py-[5px]">
        <div
          className={cn(
            'absolute inset-x-0 top-0 z-[99] py-[10px] font-medium text-[14px] leading-[14px] transition-[padding-top] duration-150',
            (!showThinking || !messages.length) && 'pt-[12px]'
          )}>
          {thinkingTimeText}
        </div>

        {showThinking && (
          <div
            className="relative h-full w-full"
            style={{
              mask: 'linear-gradient(to bottom, rgb(0 0 0 / 0%) 0%, rgb(0 0 0 / 0%) 35%, rgb(0 0 0 / 25%) 40%, rgb(0 0 0 / 100%) 90%, rgb(0 0 0 / 100%) 100%)'
            }}>
            <motion.div
              className="absolute top-full flex w-full flex-col justify-end"
              style={{
                height: messages.length * LINE_HEIGHT
              }}
              initial={{
                y: -2
              }}
              animate={{
                y: -messages.length * LINE_HEIGHT - 2
              }}
              transition={{
                duration: 0.15,
                ease: 'linear'
              }}>
              {messages.map((message, index) => {
                if (index < messages.length - 5) return null

                return (
                  <div
                    className="w-full overflow-hidden text-ellipsis whitespace-nowrap text-[11px] text-foreground-secondary leading-[14px]"
                    key={index}>
                    {message}
                  </div>
                )
              })}
            </motion.div>
          </div>
        )}
      </div>
      <div
        className={cn(
          'relative flex h-full w-10 shrink-0 items-center justify-center text-[var(--color-border)] transition-transform duration-150',
          expanded && 'rotate-90'
        )}>
        <ChevronRight size={20} color="var(--color-foreground-muted)" strokeWidth={1} />
      </div>
    </div>
  )
}

export default ThinkingEffect
