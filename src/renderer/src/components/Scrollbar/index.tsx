import { throttle } from 'lodash'
import { FC, useCallback, useEffect, useRef, useState } from 'react'
import styled from 'styled-components'

interface Props extends Omit<React.HTMLAttributes<HTMLDivElement>, 'onScroll'> {
  ref?: React.RefObject<HTMLDivElement | null>
  right?: boolean
  onScroll?: () => void // Custom onScroll prop for useScrollPosition's handleScroll
}

const Scrollbar: FC<Props> = ({ ref: passedRef, right, children, onScroll: externalOnScroll, ...htmlProps }) => {
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
    }, 1000)
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
    <Container
      {...htmlProps} // Pass other HTML attributes
      $isScrolling={isScrolling}
      $right={right}
      onScroll={combinedOnScroll} // Use the combined handler
      ref={passedRef}>
      {children}
    </Container>
  )
}

const Container = styled.div<{ $isScrolling: boolean; $right?: boolean }>`
  overflow-y: auto;
  &::-webkit-scrollbar-thumb {
    transition: background 2s ease;
    background: ${(props) =>
      props.$isScrolling ? `var(--color-scrollbar-thumb${props.$right ? '-right' : ''})` : 'transparent'};
    &:hover {
      background: ${(props) =>
        props.$isScrolling ? `var(--color-scrollbar-thumb${props.$right ? '-right' : ''}-hover)` : 'transparent'};
    }
  }
`

Scrollbar.displayName = 'Scrollbar'

export default Scrollbar
