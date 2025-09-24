// Original path: src/renderer/src/components/ThinkingEffect.tsx
import { isEqual } from 'lodash'
import { ChevronRight, Lightbulb } from 'lucide-react'
import { motion } from 'motion/react'
import React, { useEffect, useMemo, useState } from 'react'

import { cn } from '../../../utils'
import { lightbulbVariants } from './defaultVariants'

interface ThinkingEffectProps {
  isThinking: boolean
  thinkingTimeText: React.ReactNode
  content: string
  expanded: boolean
  className?: string
  ref?: React.Ref<HTMLDivElement>
}

const ThinkingEffect: React.FC<ThinkingEffectProps> = ({
  isThinking,
  thinkingTimeText,
  content,
  expanded,
  className,
  ref
}) => {
  const [messages, setMessages] = useState<string[]>([])
  useEffect(() => {
    const allLines = (content || '').split('\n')
    const newMessages = isThinking ? allLines.slice(0, -1) : allLines
    const validMessages = newMessages.filter((line) => line.trim() !== '')

    if (!isEqual(messages, validMessages)) {
      setMessages(validMessages)
    }
  }, [content, isThinking, messages])

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
      ref={ref}
      style={{ height: containerHeight }}
      className={cn(
        'w-full rounded-xl overflow-hidden relative flex items-center border-0.5 border-gray-200 dark:border-gray-700 transition-all duration-150 pointer-events-none select-none',
        expanded && 'rounded-b-none',
        className
      )}>
      <div className="w-12 flex justify-center items-center h-full flex-shrink-0 relative pl-1.5 transition-all duration-150">
        <motion.div
          variants={lightbulbVariants}
          animate={isThinking ? 'active' : 'idle'}
          initial="idle"
          className="flex justify-center items-center">
          <Lightbulb
            size={!showThinking || messages.length < 2 ? 20 : 30}
            style={{ transition: 'width,height, 150ms' }}
          />
        </motion.div>
      </div>

      <div className="flex-1 h-full py-1.5 overflow-hidden relative">
        <div
          className={cn(
            'absolute inset-x-0 top-0 text-sm leading-3.5 font-medium py-2.5 z-50 transition-all duration-150',
            (!showThinking || !messages.length) && 'pt-3'
          )}>
          {thinkingTimeText}
        </div>

        {showThinking && (
          <div
            className="w-full h-full relative"
            style={{
              mask: 'linear-gradient(to bottom, rgb(0 0 0 / 0%) 0%, rgb(0 0 0 / 0%) 35%, rgb(0 0 0 / 25%) 40%, rgb(0 0 0 / 100%) 90%, rgb(0 0 0 / 100%) 100%)'
            }}>
            <motion.div
              className="w-full absolute top-full flex flex-col justify-end"
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
                    key={index}
                    className="w-full leading-3.5 text-xs text-gray-600 dark:text-gray-300 whitespace-nowrap overflow-hidden text-ellipsis">
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
          'w-10 flex justify-center items-center h-full flex-shrink-0 relative text-gray-400 dark:text-gray-500 transition-transform duration-150',
          expanded && 'rotate-90'
        )}>
        <ChevronRight size={20} strokeWidth={1} />
      </div>
    </div>
  )
}

export default ThinkingEffect
