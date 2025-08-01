import { cn } from '@renderer/utils'
import * as React from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'

interface Tab {
  id: string
  label: string
}

interface TabsProps extends React.HTMLAttributes<HTMLDivElement> {
  tabs: Tab[]
  activeTab?: string
  onTabChange?: (tabId: string) => void
}

// 提取常用的性能优化类
const PERFORMANCE_CLASSES = 'will-change-transform [backface-visibility:hidden] [transform-style:preserve-3d]'

const TabsComponent = ({
  ref,
  className,
  tabs,
  activeTab,
  onTabChange,
  ...props
}: TabsProps & { ref?: React.RefObject<HTMLDivElement | null> }) => {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)
  const [hoverStyle, setHoverStyle] = useState({ transform: 'translate3d(0px, 0px, 0px)', width: '0px' })
  const [activeStyle, setActiveStyle] = useState({ transform: 'translate3d(0px, 0px, 0px)', width: '0px' })
  const tabRefs = useRef<(HTMLDivElement | null)[]>([])

  const activeIndex = useMemo(() => {
    if (activeTab) {
      const index = tabs.findIndex((tab) => tab.id === activeTab)
      return index !== -1 ? index : 0
    }
    return 0
  }, [activeTab, tabs])

  useEffect(() => {
    if (hoveredIndex !== null) {
      const hoveredElement = tabRefs.current[hoveredIndex]
      if (hoveredElement) {
        const { offsetLeft, offsetWidth } = hoveredElement
        setHoverStyle({
          transform: `translate3d(${offsetLeft}px, 0px, 0px)`,
          width: `${offsetWidth}px`
        })
      }
    }
  }, [hoveredIndex])

  useEffect(() => {
    requestAnimationFrame(() => {
      const activeElement = tabRefs.current[activeIndex]
      if (activeElement) {
        const { offsetLeft, offsetWidth } = activeElement
        setActiveStyle({
          transform: `translate3d(${offsetLeft}px, 0px, 0px)`,
          width: `${offsetWidth}px`
        })
      }
    })
  }, [activeIndex]) // 使用 translate3d 强制启用硬件加速

  return (
    <div ref={ref} className={cn('relative', className)} {...props}>
      <div className="relative">
        {/* Hover Highlight */}
        <div
          className={cn(
            'absolute flex h-[30px] items-center rounded-[6px]',
            'bg-[#0e0f1114] dark:bg-[#ffffff1a]',
            'transition-all duration-300 ease-out',
            PERFORMANCE_CLASSES,
            hoveredIndex !== null ? 'opacity-100' : 'opacity-0'
          )}
          style={{
            transform: hoverStyle.transform,
            width: hoverStyle.width
          }}
        />

        {/* Active Indicator */}
        <div
          className={cn(
            'absolute bottom-[-6px] h-[2px]',
            'bg-[#0e0f11] dark:bg-white',
            'transition-all duration-300 ease-out',
            PERFORMANCE_CLASSES
          )}
          style={{
            transform: activeStyle.transform,
            width: activeStyle.width
          }}
        />

        {/* Tabs */}
        <div className="relative flex items-center space-x-[6px]">
          {tabs.map((tab, index) => (
            <div
              key={tab.id}
              ref={(el) => {
                tabRefs.current[index] = el
              }}
              className={cn(
                'h-[30px] cursor-pointer px-3 py-2 transition-colors duration-300',
                index === activeIndex ? 'text-[#0e0e10] dark:text-white' : 'text-[#0e0f1199] dark:text-[#ffffff99]'
              )}
              onMouseEnter={() => setHoveredIndex(index)}
              onMouseLeave={() => setHoveredIndex(null)}
              onClick={() => {
                onTabChange?.(tab.id)
              }}>
              <div className="flex h-full items-center justify-center text-sm leading-5 font-medium whitespace-nowrap">
                {tab.label}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

const Tabs = React.memo(TabsComponent)

Tabs.displayName = 'Tabs'

export { Tabs }
