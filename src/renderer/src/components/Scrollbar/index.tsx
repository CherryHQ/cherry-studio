import { throttle } from 'lodash'
import { FC, useCallback, useEffect, useRef, useState } from 'react'
import styled from 'styled-components'

interface Props extends React.HTMLAttributes<HTMLDivElement> {
  right?: boolean
  ref?: any
}

const Scrollbar: FC<Props> = ({ ref, ...props }: Props & { ref?: React.RefObject<HTMLDivElement | null> }) => {
  const [isScrolling, setIsScrolling] = useState(false)
  const timeoutRef = useRef<NodeJS.Timeout | null>(null)

  const handleScroll = useCallback(() => {
    setIsScrolling(true)

    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
    }

    timeoutRef.current = setTimeout(() => setIsScrolling(false), 1500)
  }, [])

  const throttledHandleScroll = throttle(handleScroll, 200)

  useEffect(() => {
    return () => {
      timeoutRef.current && clearTimeout(timeoutRef.current)
      throttledHandleScroll.cancel()
    }
  }, [throttledHandleScroll])

  return (
    <Container {...props} isScrolling={isScrolling} onScroll={throttledHandleScroll} ref={ref}>
      {props.children}
    </Container>
  )
}

const Container = styled.div<{ isScrolling: boolean; right?: boolean }>`
  overflow-y: auto;
  &::-webkit-scrollbar-thumb {
    transition: background 2s ease;
    background: ${(props) =>
      props.isScrolling ? `var(--color-scrollbar-thumb${props.right ? '-right' : ''})` : 'transparent'};
    &:hover {
      background: ${(props) =>
        props.isScrolling ? `var(--color-scrollbar-thumb${props.right ? '-right' : ''}-hover)` : 'transparent'};
    }
  }
`

Scrollbar.displayName = 'Scrollbar'

export default Scrollbar
