import { FC, memo, useDeferredValue, useEffect, useRef, useState } from 'react'
import styled from 'styled-components'

const LazyItem: FC<{
  children: React.ReactNode
  minHeight?: number
  /** 距离容器底部多少像素时开始监听 */
  rootMargin?: string
  /** 出现后不再监听 */
  once?: boolean
  /** 滚动容器 */
  scrollContainer?: HTMLElement | null
}> = ({ children, minHeight = 10, once = true, scrollContainer = null, rootMargin }) => {
  const [_isVisible, setIsVisible] = useState(false)
  const isVisible = useDeferredValue(_isVisible)
  const itemRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setIsVisible(true)
          if (once) {
            observer.disconnect()
          }
        } else {
          setIsVisible(false)
        }
      },
      {
        threshold: 0.01,
        rootMargin,
        root: scrollContainer
      }
    )

    if (itemRef.current) {
      observer.observe(itemRef.current)
    }

    return () => {
      observer.disconnect()
    }
  }, [scrollContainer, rootMargin, once])

  return (
    <LazyItemContainer ref={itemRef} style={{ minHeight }}>
      {isVisible && children}
    </LazyItemContainer>
  )
}

const LazyItemContainer = styled.div`
  @keyframes itemIn {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }
  min-height: 10px;
  animation: itemIn 0.15s ease;
`

export default memo(LazyItem)
