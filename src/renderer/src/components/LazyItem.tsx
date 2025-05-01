import { FC, memo, useEffect, useRef, useState } from 'react'
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
}> = ({ children, minHeight = 10, once = true, scrollContainer = null, rootMargin = '100px' }) => {
  const [isVisible, setIsVisible] = useState(false)
  const itemRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let timer: NodeJS.Timeout | null = null
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          timer && clearTimeout(timer)
          once && observer.disconnect()

          setIsVisible(true)
        } else {
          timer = setTimeout(() => {
            setIsVisible(false)
          }, 200)
        }
      },
      {
        threshold: 0.1,
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
