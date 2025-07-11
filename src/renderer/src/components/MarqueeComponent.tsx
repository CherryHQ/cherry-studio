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

const MarqueeComponent: React.FC<Props> = ({ isThinking, thinkingTimeText, content, expanded }) => {
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
    <MarqueeContainer style={{ height: containerHeight }} className={expanded ? 'expanded' : ''}>
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
                  <motion.div
                    key={`${index}-${message}`}
                    className="marquee-item"
                    initial={{
                      opacity: index === messages.length - 1 ? 0 : 1,
                      y: index === messages.length - 1 ? containerHeight : finalY + lineHeight
                    }}
                    animate={{
                      opacity: 1,
                      y: finalY
                    }}
                    transition={{
                      duration: 0.1,
                      ease: 'easeOut'
                    }}
                    style={{
                      position: 'absolute',
                      width: '100%',
                      height: lineHeight
                    }}>
                    {message}
                  </motion.div>
                )
              })}
            </AnimatePresence>
          </Content>
        )}
      </TextContainer>
      <ArrowContainer className={expanded ? 'expanded' : ''}>
        <ChevronRight size={20} color="var(--color-text-3)" strokeWidth={1.2} />
      </ArrowContainer>
    </MarqueeContainer>
  )
}

const MarqueeContainer = styled(motion.div)`
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
  background: linear-gradient(
    to bottom,
    var(--color-background) 35%,
    var(--color-background) 40%,
    rgba(255, 255, 255, 0) 100%
  );
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
  .marquee-item {
    line-height: 16px;
    font-size: 12px;
    color: var(--color-text-2);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  /* .marquee-item:last-child {
    filter: blur(1.5px);
  }
  .marquee-item:nth-last-child(2) {
    filter: blur(0.8px);
  }
  .marquee-item:first-child {
    filter: none;
  } */
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

export default MarqueeComponent
