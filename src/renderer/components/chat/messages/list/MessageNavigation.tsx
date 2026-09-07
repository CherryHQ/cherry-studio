import { Button, Tooltip } from '@cherrystudio/ui'
import { useTimer } from '@renderer/hooks/useTimer'
import { ArrowDown, ArrowUp, ChevronsDown, ChevronsUp, X } from 'lucide-react'
import type { ComponentPropsWithoutRef, FC, RefObject } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { MessageListItem } from '../types'
import { getOwningUserMessageIdByAssistantId } from '../utils/messageGroupKey'

const EXCLUDED_SELECTORS = [
  '.MessageFooter',
  '.code-toolbar',
  '.group-menu-bar',
  '.code-block',
  '.message-editor',
  '.table-wrapper'
]

const RIGHT_GAP = 16
const TRIGGER_WIDTH = 60

interface MessageNavigationProps {
  scrollContainerRef: RefObject<HTMLElement | null>
  getMessageElement: (messageId: string) => HTMLElement | null
  getNavigationBaseMessageId: () => string | null
  messages: MessageListItem[]
  scrollToMessageId: (messageId: string) => void
  scrollToTop: () => void
  scrollToBottom: () => void
}

const MessageNavigation: FC<MessageNavigationProps> = ({
  scrollContainerRef,
  getMessageElement,
  getNavigationBaseMessageId,
  messages,
  scrollToMessageId,
  scrollToTop,
  scrollToBottom
}) => {
  const { t } = useTranslation()
  const [isVisible, setIsVisible] = useState(false)
  const timerKey = 'hide'
  const { setTimeoutTimer, clearTimeoutTimer } = useTimer()
  const [manuallyClosedUntil, setManuallyClosedUntil] = useState<number | null>(null)
  const lastMoveTime = useRef(0)
  const isHoveringNavigationRef = useRef(false)
  const isPointerInTriggerAreaRef = useRef(false)

  const clearHideTimer = useCallback(() => {
    clearTimeoutTimer(timerKey)
  }, [clearTimeoutTimer])

  const scheduleHide = useCallback(
    (delay: number) => {
      setTimeoutTimer(
        timerKey,
        () => {
          setIsVisible(false)
        },
        delay
      )
    },
    [setTimeoutTimer]
  )

  const showNavigation = useCallback(() => {
    if (manuallyClosedUntil && Date.now() < manuallyClosedUntil) return
    setIsVisible(true)
    clearHideTimer()
  }, [clearHideTimer, manuallyClosedUntil])

  const handleNavigationMouseEnter = useCallback(() => {
    if (manuallyClosedUntil && Date.now() < manuallyClosedUntil) return
    isHoveringNavigationRef.current = true
    showNavigation()
  }, [manuallyClosedUntil, showNavigation])

  const handleNavigationMouseLeave = useCallback(() => {
    isHoveringNavigationRef.current = false
    scheduleHide(500)
  }, [scheduleHide])

  const getCurrentVisibleIndex = () => {
    const userMessages = messages.filter((message) => message.role === 'user')
    const assistantMessages = messages.filter((message) => message.role === 'assistant')
    const userIndexById = new Map(userMessages.map((message, index) => [message.id, index]))
    const owningUserMessageIdByAssistantId = getOwningUserMessageIdByAssistantId(messages)
    const scrollContainer = scrollContainerRef.current

    if (!scrollContainer) return -1

    const containerRect = scrollContainer.getBoundingClientRect()
    const visibleThreshold = containerRect.height * 0.1

    let visibleIndices: number[] = []

    for (let i = 0; i < userMessages.length; i++) {
      const messageElement = getMessageElement(userMessages[i].id)
      if (!messageElement) continue

      const messageRect = messageElement.getBoundingClientRect()
      const visibleHeight =
        Math.min(messageRect.bottom, containerRect.bottom) - Math.max(messageRect.top, containerRect.top)
      if (visibleHeight > 0 && visibleHeight >= Math.min(messageRect.height, visibleThreshold)) {
        visibleIndices.push(i)
      }
    }

    if (visibleIndices.length > 0) {
      return Math.min(...visibleIndices)
    }

    visibleIndices = []
    for (let i = 0; i < assistantMessages.length; i++) {
      const assistantMessage = assistantMessages[i]
      const messageElement = getMessageElement(assistantMessage.id)
      if (!messageElement) continue

      const messageRect = messageElement.getBoundingClientRect()
      const visibleHeight =
        Math.min(messageRect.bottom, containerRect.bottom) - Math.max(messageRect.top, containerRect.top)
      if (visibleHeight > 0 && visibleHeight >= Math.min(messageRect.height, visibleThreshold)) {
        const ownerId = owningUserMessageIdByAssistantId.get(assistantMessage.id)
        const userIndex = ownerId ? userIndexById.get(ownerId) : undefined
        if (userIndex !== undefined) visibleIndices.push(userIndex)
      }
    }

    if (visibleIndices.length > 0) {
      return Math.min(...visibleIndices)
    }

    return -1
  }

  const getNavigationBaseIndex = (userMessages: MessageListItem[]) => {
    const navigationBaseMessageId = getNavigationBaseMessageId()
    const explicitBaseIndex = navigationBaseMessageId
      ? userMessages.findIndex((message) => message.id === navigationBaseMessageId)
      : -1

    return explicitBaseIndex >= 0 ? explicitBaseIndex : getCurrentVisibleIndex()
  }

  const handleCloseMessageNavigation = () => {
    setIsVisible(false)
    isHoveringNavigationRef.current = false
    isPointerInTriggerAreaRef.current = false
    clearHideTimer()
    setManuallyClosedUntil(Date.now() + 60000)
  }

  const handleScrollToTop = () => {
    showNavigation()
    scrollToTop()
  }

  const handleScrollToBottom = () => {
    showNavigation()
    scrollToBottom()
  }

  const handleNextMessage = () => {
    showNavigation()
    const userMessages = messages.filter((message) => message.role === 'user')
    const assistantMessages = messages.filter((message) => message.role === 'assistant')

    if (userMessages.length === 0 && assistantMessages.length === 0) return scrollToBottom()

    const baseIndex = getNavigationBaseIndex(userMessages)
    if (baseIndex === -1) return scrollToBottom()

    const targetIndex = baseIndex + 1
    if (targetIndex >= userMessages.length) return scrollToBottom()

    scrollToMessageId(userMessages[targetIndex].id)
  }

  const handlePrevMessage = () => {
    showNavigation()
    const userMessages = messages.filter((message) => message.role === 'user')
    const assistantMessages = messages.filter((message) => message.role === 'assistant')
    if (userMessages.length === 0 && assistantMessages.length === 0) return scrollToTop()

    const baseIndex = getNavigationBaseIndex(userMessages)
    if (baseIndex === -1) return scrollToTop()

    const targetIndex = baseIndex - 1
    if (targetIndex < 0) return scrollToTop()

    scrollToMessageId(userMessages[targetIndex].id)
  }

  useEffect(() => {
    const scrollContainer = scrollContainerRef.current

    if (!scrollContainer) return

    const handleScroll = () => {
      if (isPointerInTriggerAreaRef.current || isHoveringNavigationRef.current) {
        showNavigation()
      }
    }

    const handleMouseMove = (event: MouseEvent) => {
      if (manuallyClosedUntil && Date.now() < manuallyClosedUntil) return

      const now = Date.now()
      if (now - lastMoveTime.current < 50) return
      lastMoveTime.current = now

      const containerRect = scrollContainer.getBoundingClientRect()
      const rightPosition = containerRect.right - RIGHT_GAP - TRIGGER_WIDTH
      const topPosition = containerRect.top + containerRect.height * 0.35
      const height = containerRect.height * 0.3

      const target = event.target as HTMLElement
      const isInExcludedArea = EXCLUDED_SELECTORS.some((selector) => target.closest(selector))
      const isInTriggerArea =
        !isInExcludedArea &&
        event.clientX > rightPosition &&
        event.clientX < rightPosition + TRIGGER_WIDTH + RIGHT_GAP &&
        event.clientY > topPosition &&
        event.clientY < topPosition + height

      if (isInTriggerArea) {
        if (!isPointerInTriggerAreaRef.current) {
          isPointerInTriggerAreaRef.current = true
          showNavigation()
        }
      } else if (isPointerInTriggerAreaRef.current) {
        isPointerInTriggerAreaRef.current = false
        if (!isHoveringNavigationRef.current) {
          scheduleHide(500)
        }
      }
    }

    scrollContainer.addEventListener('scroll', handleScroll, { passive: true })
    window.addEventListener('mousemove', handleMouseMove)

    const handleMessagesMouseLeave = () => {
      if (!isHoveringNavigationRef.current) {
        isPointerInTriggerAreaRef.current = false
        scheduleHide(500)
      }
    }
    scrollContainer.addEventListener('mouseleave', handleMessagesMouseLeave)

    return () => {
      scrollContainer.removeEventListener('scroll', handleScroll)
      window.removeEventListener('mousemove', handleMouseMove)
      scrollContainer.removeEventListener('mouseleave', handleMessagesMouseLeave)
      clearHideTimer()
    }
  }, [scrollContainerRef, manuallyClosedUntil, scheduleHide, showNavigation, clearHideTimer])

  return (
    <NavigationContainer
      $isVisible={isVisible}
      onMouseEnter={handleNavigationMouseEnter}
      onMouseLeave={handleNavigationMouseLeave}>
      <ButtonGroup $isVisible={isVisible}>
        <Tooltip placement="left" content={t('chat.navigation.close')} delay={500}>
          <NavigationButton
            variant="ghost"
            onClick={handleCloseMessageNavigation}
            aria-label={t('chat.navigation.close')}>
            <X />
          </NavigationButton>
        </Tooltip>
        <Divider />
        <Tooltip placement="left" content={t('chat.navigation.top')} delay={500}>
          <NavigationButton variant="ghost" onClick={handleScrollToTop} aria-label={t('chat.navigation.top')}>
            <ChevronsUp />
          </NavigationButton>
        </Tooltip>
        <Divider />
        <Tooltip placement="left" content={t('chat.navigation.prev')} delay={500}>
          <NavigationButton variant="ghost" onClick={handlePrevMessage} aria-label={t('chat.navigation.prev')}>
            <ArrowUp />
          </NavigationButton>
        </Tooltip>
        <Divider />
        <Tooltip placement="left" content={t('chat.navigation.next')} delay={500}>
          <NavigationButton variant="ghost" onClick={handleNextMessage} aria-label={t('chat.navigation.next')}>
            <ArrowDown />
          </NavigationButton>
        </Tooltip>
        <Divider />
        <Tooltip placement="left" content={t('chat.navigation.bottom')} delay={500}>
          <NavigationButton variant="ghost" onClick={handleScrollToBottom} aria-label={t('chat.navigation.bottom')}>
            <ChevronsDown />
          </NavigationButton>
        </Tooltip>
      </ButtonGroup>
    </NavigationContainer>
  )
}

interface NavigationContainerProps {
  $isVisible: boolean
}

const NavigationContainer = ({
  className,
  $isVisible,
  style,
  ...props
}: ComponentPropsWithoutRef<'div'> & NavigationContainerProps) => (
  <div
    className={['absolute top-1/2 right-4 z-[80] transition-[transform,opacity] duration-300 ease-in-out', className]
      .filter(Boolean)
      .join(' ')}
    style={{
      opacity: $isVisible ? 1 : 0,
      pointerEvents: $isVisible ? 'auto' : 'none',
      transform: `translateY(-50%) translateX(${$isVisible ? '0' : '32px'})`,
      ...style
    }}
    {...props}
  />
)

interface ButtonGroupProps {
  $isVisible: boolean
}

const ButtonGroup = ({
  className,
  $isVisible,
  style,
  ...props
}: ComponentPropsWithoutRef<'div'> & ButtonGroupProps) => (
  <div
    className={[
      'flex flex-col overflow-hidden rounded-lg border border-border bg-background shadow-[0_2px_8px_rgba(0,0,0,0.1)] transition-[backdrop-filter,background] duration-250 ease-in-out',
      className
    ]
      .filter(Boolean)
      .join(' ')}
    style={{ backdropFilter: $isVisible ? 'blur(8px)' : 'blur(0px)', ...style }}
    {...props}
  />
)

const NavigationButton = ({ className, ...props }: ComponentPropsWithoutRef<typeof Button>) => (
  <Button
    className={[
      'flex h-7 w-7 items-center justify-center rounded-none border-none text-foreground transition-all duration-200 ease-in-out hover:bg-accent hover:text-primary [&_svg]:size-3.5',
      className
    ]
      .filter(Boolean)
      .join(' ')}
    {...props}
  />
)

const Divider = ({ className, ...props }: ComponentPropsWithoutRef<'div'>) => (
  <div className={['m-0 h-px bg-border', className].filter(Boolean).join(' ')} {...props} />
)

export default MessageNavigation
