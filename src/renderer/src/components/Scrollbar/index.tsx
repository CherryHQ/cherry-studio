import { throttle } from 'lodash'
import { FC, useCallback, useEffect, useRef, useState } from 'react'
import styled from 'styled-components'

interface Props extends Omit<React.HTMLAttributes<HTMLDivElement>, 'onScroll'> {
  ref?: React.Ref<HTMLDivElement | null>
  onScroll?: () => void // Custom onScroll prop for useScrollPosition's handleScroll
}

const Scrollbar: FC<Props> = ({ ref: passedRef, children, onScroll: externalOnScroll, ...htmlProps }) => {
  const [isScrolling, setIsScrolling] = useState(false)
  const timeoutRef = useRef<NodeJS.Timeout | null>(null)

  const clearScrollingTimeout = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
  }, [])

  const handleScroll = useCallback(() => {
    setIsScrolling(true)
    clearScrollingTimeout()
    timeoutRef.current = setTimeout(() => {
      setIsScrolling(false)
      timeoutRef.current = null
    }, 1500)
  }, [clearScrollingTimeout])

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const throttledInternalScrollHandler = useCallback(throttle(handleScroll, 100, { leading: true, trailing: true }), [
    handleScroll
  ])

  // Combined scroll handler
  const combinedOnScroll = useCallback(() => {
    throttledInternalScrollHandler()
    if (externalOnScroll) {
      externalOnScroll()
    }
  }, [throttledInternalScrollHandler, externalOnScroll])

  useEffect(() => {
    return () => {
      clearScrollingTimeout()
      throttledInternalScrollHandler.cancel()
    }
  }, [throttledInternalScrollHandler, clearScrollingTimeout])

  return (
    <ScrollBarContainer
      {...htmlProps} // Pass other HTML attributes
      $isScrolling={isScrolling}
      onScroll={combinedOnScroll} // Use the combined handler
      ref={passedRef}>
      {children}
    </ScrollBarContainer>
  )
}

const ScrollBarContainer = styled.div<{ $isScrolling: boolean }>`
  overflow-y: auto;
  &::-webkit-scrollbar-thumb {
    transition: background 2s ease;
    background: ${(props) => (props.$isScrolling ? 'var(--color-scrollbar-thumb)' : 'transparent')};
    &:hover {
      background: var(--color-scrollbar-thumb-hover);
    }
  }
`

Scrollbar.displayName = 'Scrollbar'

export default Scrollbar
