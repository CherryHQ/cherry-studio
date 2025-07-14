import { lightbulbVariants } from '@renderer/utils/motionVariants'
import { isEqual } from 'lodash'
import { ChevronRight, Lightbulb } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import React, { useEffect, useMemo, useState } from 'react'
import styled from 'styled-components'

interface Props {
  isThinking: boolean
  thinkingTimeText: React.ReactNode
  content: string
  expanded: boolean
}

const ThinkingEffect: React.FC<Props> = ({ isThinking, thinkingTimeText, content, expanded }) => {
  const [messages, setMessages] = useState<string[]>([])

  useEffect(() => {
    const allLines = (content || '').split('\n')
    const newMessages = isThinking ? allLines.slice(0, -1) : allLines
    const validMessages = newMessages.filter((line) => line.trim() !== '')

    if (!isEqual(messages, validMessages)) {
      setMessages(validMessages)
    }
  }, [content, isThinking, messages])

  const lineHeight = 16
  const containerHeight = useMemo(() => {
    if (expanded) return lineHeight * 3
    return Math.min(80, Math.max(messages.length + 2, 3) * lineHeight)
  }, [expanded, messages.length])

  return (
    <ThinkingContainer style={{ height: containerHeight }} className={expanded ? 'expanded' : ''}>
      <LoadingContainer className={expanded || !messages.length ? 'expanded' : ''}>
        <motion.div variants={lightbulbVariants} animate={isThinking ? 'active' : 'idle'} initial="idle">
          <Lightbulb size={expanded || !messages.length ? 20 : 30} style={{ transition: 'width,height, 150ms' }} />
        </motion.div>
      </LoadingContainer>

      <TextContainer>
        <Title className={expanded || !messages.length ? 'expanded' : ''}>{thinkingTimeText}</Title>

        {!expanded && (
          <Content>
            <AnimatePresence>
              {messages.map((message, index) => {
                const finalY = containerHeight - (messages.length - index) * lineHeight - 4

                if (index < messages.length - 5) return null

                return (
                  <ContentLineMotion
                    key={index}
                    initial={{
                      y: index === messages.length - 1 ? containerHeight : finalY + lineHeight,
                      height: lineHeight
                    }}
                    animate={{
                      y: finalY
                    }}
                    transition={{
                      duration: 0.15,
                      ease: 'linear'
                    }}>
                    {message}
                  </ContentLineMotion>
                )
              })}
            </AnimatePresence>
          </Content>
        )}
      </TextContainer>
      <ArrowContainer className={expanded ? 'expanded' : ''}>
        <ChevronRight size={20} color="var(--color-text-3)" strokeWidth={1.2} />
      </ArrowContainer>
    </ThinkingContainer>
  )
}

const ThinkingContainer = styled(motion.div)`
  width: 100%;
  border-radius: 12px;
  overflow: hidden;
  position: relative;
  display: flex;
  align-items: center;
  border: 0.5px solid var(--color-border);
  transition: height, border-radius, 150ms;
  pointer-events: none;
  user-select: none;
  &.expanded {
    border-radius: 12px 12px 0 0;
  }
`

const Title = styled.div`
  position: absolute;
  inset: 0 0 auto 0;
  font-size: 14px;
  font-weight: 500;
  padding: 4px 0 30px;
  z-index: 99;
  transition: padding-top 150ms;
  &.expanded {
    padding-top: 14px;
  }
`

const LoadingContainer = styled.div`
  width: 60px;
  display: flex;
  justify-content: center;
  align-items: center;
  height: 100%;
  flex-shrink: 0;
  position: relative;
  padding-left: 5px;
  transition: width 150ms;
  > div {
    display: flex;
    justify-content: center;
    align-items: center;
  }
  &.expanded {
    width: 40px;
  }
`

const TextContainer = styled.div`
  flex: 1;
  height: 100%;
  overflow: hidden;
  position: relative;
`

const Content = styled(motion.div)`
  width: 100%;
  height: 100%;
  mask: linear-gradient(
    to bottom,
    rgb(0 0 0 / 0%) 0%,
    rgb(0 0 0 / 0%) 35%,
    rgb(0 0 0 / 25%) 40%,
    rgb(0 0 0 / 100%) 90%,
    rgb(0 0 0 / 100%) 100%
  );
`

const ContentLineMotion = styled(motion.div)`
  width: 100%;
  line-height: 16px;
  font-size: 12px;
  color: var(--color-text-2);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  position: absolute;
`

const ArrowContainer = styled.div`
  width: 40px;
  display: flex;
  justify-content: center;
  align-items: center;
  height: 100%;
  flex-shrink: 0;
  position: relative;
  color: var(--color-border);
  transition: transform 150ms;
  &.expanded {
    transform: rotate(90deg);
  }
`

export default ThinkingEffect
