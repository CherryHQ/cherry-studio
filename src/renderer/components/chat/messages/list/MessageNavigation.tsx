import { Button, Tooltip } from '@cherrystudio/ui'
import { useTimer } from '@renderer/hooks/useTimer'
import { ArrowDown, ArrowUp, ChevronsDown, ChevronsUp, X } from 'lucide-react'
import type { ComponentPropsWithoutRef, FC } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { MessageListItem } from '../types'

const EXCLUDED_SELECTORS = [
  '.MessageFooter',
  '.code-toolbar',
  '.ant-collapse-header',
  '.group-menu-bar',
  '.code-block',
  '.message-editor',
  '.table-wrapper'
]

const RIGHT_GAP = 16
const TRIGGER_WIDTH = 60

interface MessageNavigationProps {
  containerId: string
  messages: MessageListItem[]
  scrollToMessageId: (messageId: string) => void
}

const getScrollContainer = (container: HTMLElement | null): HTMLElement | null => {
  return container?.querySelector<HTMLElement>('[data-message-virtual-list-scroller]') ?? container
}

const MessageNavigation: FC<MessageNavigationProps> = ({ containerId, messages, scrollToMessageId }) => {
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

  const scrollToTop = () => {
    const scrollContainer = getScrollContainer(document.getElementById(containerId))
    scrollContainer?.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const scrollToBottom = () => {
    const scrollContainer = getScrollContainer(document.getElementById(containerId))
    scrollContainer?.scrollTo({ top: scrollContainer.scrollHeight, behavior: 'smooth' })
  }

  const getCurrentVisibleIndex = (direction: 'up' | 'down') => {
    const userMessages = messages.filter((message) => message.role === 'user')
    const assistantMessages = messages.filter((message) => message.role === 'assistant')
    const scrollContainer = getScrollContainer(document.getElementById(containerId))

    if (!scrollContainer) return -1

    const containerRect = scrollContainer.getBoundingClientRect()
    const visibleThreshold = containerRect.height * 0.1

    let visibleIndices: number[] = []

    for (let i = 0; i < userMessages.length; i++) {
      const messageElement = document.getElementById(`message-${userMessages[i].id}`)
      if (!messageElement) continue

      const messageRect = messageElement.getBoundingClientRect()
      const visibleHeight =
        Math.min(messageRect.bottom, containerRect.bottom) - Math.max(messageRect.top, containerRect.top)
      if (visibleHeight > 0 && visibleHeight >= Math.min(messageRect.height, visibleThreshold)) {
        visibleIndices.push(i)
      }
    }

    if (visibleIndices.length > 0) {
      return direction === 'up' ? Math.max(...visibleIndices) : Math.min(...visibleIndices)
    }

    visibleIndices = []
    for (let i = 0; i < assistantMessages.length; i++) {
      const messageElement = document.getElementById(`message-${assistantMessages[i].id}`)
      if (!messageElement) continue

      const messageRect = messageElement.getBoundingClientRect()
      const visibleHeight =
        Math.min(messageRect.bottom, containerRect.bottom) - Math.max(messageRect.top, containerRect.top)
      if (visibleHeight > 0 && visibleHeight >= Math.min(messageRect.height, visibleThreshold)) {
        visibleIndices.push(i)
      }
    }

    if (visibleIndices.length > 0) {
      const assistantIndex = direction === 'up' ? Math.max(...visibleIndices) : Math.min(...visibleIndices)
      return assistantIndex < userMessages.length ? assistantIndex : userMessages.length - 1
    }

    return -1
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

    const visibleIndex = getCurrentVisibleIndex('down')
    if (visibleIndex === -1) return scrollToBottom()

    const targetIndex = visibleIndex - 1
    if (targetIndex < 0) return scrollToBottom()

    scrollToMessageId(userMessages[targetIndex].id)
  }

  const handlePrevMessage = () => {
    showNavigation()
    const userMessages = messages.filter((message) => message.role === 'user')
    const assistantMessages = messages.filter((message) => message.role === 'assistant')
    if (userMessages.length === 0 && assistantMessages.length === 0) return scrollToTop()

    const visibleIndex = getCurrentVisibleIndex('up')
    if (visibleIndex === -1) return scrollToTop()

    const targetIndex = visibleIndex + 1
    if (targetIndex >= userMessages.length) return scrollToTop()

    scrollToMessageId(userMessages[targetIndex].id)
  }

  useEffect(() => {
    const container = document.getElementById(containerId)
    const scrollContainer = getScrollContainer(container)

    if (!container || !scrollContainer) return

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

      const containerRect = container.getBoundingClientRect()
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
    container.addEventListener('mouseleave', handleMessagesMouseLeave)

    return () => {
      scrollContainer.removeEventListener('scroll', handleScroll)
      window.removeEventListener('mousemove', handleMouseMove)
      container.removeEventListener('mouseleave', handleMessagesMouseLeave)
      clearHideTimer()
    }
  }, [containerId, manuallyClosedUntil, scheduleHide, showNavigation, clearHideTimer])

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
  <div className={['m-0 h-px bg-(--color-border)', className].filter(Boolean).join(' ')} {...props} />
)

export default MessageNavigation
