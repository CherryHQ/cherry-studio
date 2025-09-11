import type { Editor } from '@tiptap/core'
import type { TableOfContentDataItem } from '@tiptap/extension-table-of-contents'
import { TextSelection } from '@tiptap/pm/state'
import React, { useEffect, useState } from 'react'

import { TableOfContentsWrapper, ToCDock } from './styles'

interface ToCItemProps {
  item: TableOfContentDataItem
  onItemClick: (e: React.MouseEvent, id: string) => void
}

export const ToCItem: React.FC<ToCItemProps> = ({ item, onItemClick }) => {
  // Fix: Always show active state when selected by algorithm, regardless of scroll position
  const isActive = item.isActive
  const isScrolledOver = item.isScrolledOver
  const className = `toc-item ${isActive ? 'is-active' : ''} ${isScrolledOver ? 'is-scrolled-over' : ''}`

  return (
    <div
      className={className}
      style={
        {
          '--level': item.level
        } as React.CSSProperties
      }>
      <a href={`#${item.id}`} onClick={(e) => onItemClick(e, item.id)} data-item-index={item.itemIndex}>
        {item.textContent}
      </a>
    </div>
  )
}

interface ToCProps {
  items?: TableOfContentDataItem[]
  editor?: Editor | null
  scrollContainerRef?: React.RefObject<HTMLDivElement | null>
}

export const ToC: React.FC<ToCProps> = ({ items = [], editor, scrollContainerRef }) => {
  // Filter to only show first 3 levels (H1-H3) to avoid overcrowding
  const filteredItems = items.filter((item) => item.level <= 3)
  const [maxDisplayItems, setMaxDisplayItems] = useState(30)

  // Dynamic calculation based on container height
  useEffect(() => {
    const calculateMaxItems = () => {
      if (!scrollContainerRef?.current) return

      const containerHeight = scrollContainerRef.current.clientHeight
      // Each button: 4px height + 4px gap = 8px total
      // Reserve 40px for padding
      const availableHeight = containerHeight - 40
      const itemHeight = 8 // 4px button + 4px gap
      const calculatedMax = Math.floor(availableHeight / itemHeight)

      setMaxDisplayItems(Math.max(10, Math.min(calculatedMax, 50))) // Min 10, max 50
    }

    calculateMaxItems()

    // Recalculate on resize
    const resizeObserver = new ResizeObserver(calculateMaxItems)
    if (scrollContainerRef?.current) {
      resizeObserver.observe(scrollContainerRef.current)
    }

    return () => resizeObserver.disconnect()
  }, [scrollContainerRef, filteredItems.length])

  // Smart sampling: if too many items, sample evenly to maintain scroll highlighting
  const displayItems =
    filteredItems.length <= maxDisplayItems
      ? filteredItems
      : (() => {
          const step = filteredItems.length / maxDisplayItems
          const sampled: TableOfContentDataItem[] = []
          for (let i = 0; i < maxDisplayItems; i++) {
            const index = Math.floor(i * step)
            sampled.push(filteredItems[index])
          }
          return sampled
        })()

  if (displayItems.length === 0) {
    return null
  }

  const onItemClick = (e: React.MouseEvent, id: string) => {
    e.preventDefault()

    if (editor && scrollContainerRef?.current) {
      const element = editor.view.dom.querySelector(`[data-toc-id="${id}"]`) as HTMLElement
      if (element) {
        const container = scrollContainerRef.current
        const pos = editor.view.posAtDOM(element, 0)

        const tr = editor.view.state.tr

        tr.setSelection(new TextSelection(tr.doc.resolve(pos)))

        editor.view.dispatch(tr)

        editor.view.focus()

        if (history.pushState) {
          history.pushState(null, '', `#${id}`)
        }

        // Calculate correct scroll position to put element at top of viewport
        const elementTop = element.getBoundingClientRect().top
        const containerTop = container.getBoundingClientRect().top
        const targetScrollTop = container.scrollTop + (elementTop - containerTop)

        // Smooth scroll to target position
        container.scrollTo({
          top: targetScrollTop,
          behavior: 'smooth'
        })

        // Force TableOfContents extension to recalculate highlighting after scroll
        setTimeout(() => {
          const scrollEvent = new Event('scroll', { bubbles: true })
          container.dispatchEvent(scrollEvent)
        }, 300) // Wait for smooth scroll to complete
      }
    }
  }

  return (
    <ToCDock>
      <div className="toc-rail" data-item-count={displayItems.length}>
        {displayItems.map((item) => (
          <button
            type="button"
            key={`rail-${item.id}`}
            className={`toc-rail-button level-${item.level} ${item.isActive ? 'active' : ''} ${item.isScrolledOver ? 'scrolled-over' : ''}`}
            title={item.textContent}
            onClick={(e) => onItemClick(e, item.id)}
          />
        ))}
      </div>

      {/* floating panel */}
      <div className="toc-panel">
        <TableOfContentsWrapper>
          <div className="table-of-contents">
            {filteredItems.map((item) => (
              <ToCItem onItemClick={onItemClick} key={item.id} item={item} />
            ))}
          </div>
        </TableOfContentsWrapper>
      </div>
    </ToCDock>
  )
}

export default React.memo(ToC)
