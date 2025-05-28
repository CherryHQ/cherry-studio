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

  const handleScroll = useCallback(() => {
    setIsScrolling(true)

    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
    }

    timeoutRef.current = setTimeout(() => setIsScrolling(false), 1500)
  }, [])

  const throttledInternalScrollHandler = throttle(handleScroll, 200)

  // Combined scroll handler
  const combinedOnScroll = useCallback(() => {
    // Event is available if needed by internal handler
    throttledInternalScrollHandler() // Call internal logic
    if (externalOnScroll) {
      externalOnScroll() // Call external logic (from useScrollPosition)
    }
  }, [throttledInternalScrollHandler, externalOnScroll])

  useEffect(() => {
    return () => {
      timeoutRef.current && clearTimeout(timeoutRef.current)
      throttledInternalScrollHandler.cancel()
    }
  }, [throttledInternalScrollHandler])

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
