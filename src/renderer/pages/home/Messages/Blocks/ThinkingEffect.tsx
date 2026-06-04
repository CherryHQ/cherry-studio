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
      style={{ height: containerHeight }}
      className={cn(
        'pointer-events-none relative flex w-full select-none items-center overflow-hidden rounded-[10px] border-(--color-border) border-[0.5px] border-solid transition-[height,border-radius] duration-150',
        expanded && 'rounded-b-none'
      )}>
      {/* Loading icon container */}
      <div className="relative flex h-full w-12.5 shrink-0 items-center justify-center pl-1.25 transition-[width] duration-150 [&>div]:flex [&>div]:items-center [&>div]:justify-center">
        <motion.div variants={lightbulbVariants} animate={isThinking ? 'active' : 'idle'} initial="idle">
          <Lightbulb
            size={!showThinking || messages.length < 2 ? 20 : 30}
            style={{ transition: 'width,height, 150ms' }}
          />
        </motion.div>
      </div>

      {/* Text container */}
      <div className="relative h-full flex-1 overflow-hidden py-1.25">
        <div
          className={cn(
            'absolute inset-x-0 top-0 z-99 py-2.5 font-medium text-sm leading-3.5 transition-[padding-top] duration-150',
            (!showThinking || !messages.length) && 'pt-3'
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
                  <div key={index} className="w-full truncate text-(--color-text-2) text-[11px] leading-3.5">
                    {message}
                  </div>
                )
              })}
            </motion.div>
          </div>
        )}
      </div>

      {/* Arrow container */}
      <div
        className={cn(
          'relative flex h-full w-10 shrink-0 items-center justify-center text-(--color-border) transition-transform duration-150',
          expanded && 'rotate-90'
        )}>
        <ChevronRight size={20} color="var(--color-text-3)" strokeWidth={1} />
      </div>
    </div>
  )
}

export default ThinkingEffect
