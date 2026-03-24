import { useRef, useState } from 'react'

import type { SidebarDragCallbacks, SidebarDragGhost, SidebarUndockCallbacks, UseSidebarDragReturn } from './types'

export function useSidebarDrag(): UseSidebarDragReturn {
  const [dragGhost, setDragGhost] = useState<SidebarDragGhost | null>(null)
  const sidebarContainerRef = useRef<HTMLDivElement>(null)

  const startTabDrag: UseSidebarDragReturn['startTabDrag'] = (e, tabId, callbacks: SidebarDragCallbacks) => {
    if (e.button !== 0) return

    const startX = e.clientX
    const startY = e.clientY
    let dragging = false

    const isOverSidebar = (clientX: number, clientY: number) => {
      if (!sidebarContainerRef.current) return false
      const rect = sidebarContainerRef.current.getBoundingClientRect()
      return clientX >= rect.left && clientX <= rect.right + 20 && clientY >= rect.top && clientY <= rect.bottom
    }

    const onMove = (event: MouseEvent) => {
      const dx = event.clientX - startX
      const dy = event.clientY - startY

      if (!dragging && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) {
        dragging = true
        document.body.style.cursor = 'grabbing'
        document.body.style.userSelect = 'none'
      }

      if (dragging) {
        setDragGhost({
          tabId,
          x: event.clientX,
          y: event.clientY,
          overSidebar: isOverSidebar(event.clientX, event.clientY)
        })
      }
    }

    const onUp = (event: MouseEvent) => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''

      if (dragging) {
        const overSidebar = isOverSidebar(event.clientX, event.clientY)
        if (overSidebar) {
          callbacks.onDockToSidebar(tabId)
        } else if (Math.abs(event.clientY - startY) > 50) {
          callbacks.onDetachTab(tabId, event.clientX - 100, event.clientY - 20)
        }
      }

      setDragGhost(null)
    }

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  const startSidebarDrag: UseSidebarDragReturn['startSidebarDrag'] = (e, tabId, callbacks: SidebarUndockCallbacks) => {
    if (e.button !== 0) return

    const startX = e.clientX
    const startY = e.clientY
    let dragging = false

    const isOverSidebar = (clientX: number, clientY: number) => {
      if (!sidebarContainerRef.current) return true
      const rect = sidebarContainerRef.current.getBoundingClientRect()
      return clientX >= rect.left && clientX <= rect.right + 10 && clientY >= rect.top && clientY <= rect.bottom
    }

    const onMove = (event: MouseEvent) => {
      const dx = event.clientX - startX
      const dy = event.clientY - startY

      if (!dragging && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) {
        dragging = true
        document.body.style.cursor = 'grabbing'
        document.body.style.userSelect = 'none'
      }

      if (dragging) {
        setDragGhost({
          tabId,
          x: event.clientX,
          y: event.clientY,
          overSidebar: isOverSidebar(event.clientX, event.clientY)
        })
      }
    }

    const onUp = (event: MouseEvent) => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''

      if (dragging && !isOverSidebar(event.clientX, event.clientY)) {
        callbacks.onUndockFromSidebar(tabId)
      }

      setDragGhost(null)
    }

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  return {
    dragGhost,
    sidebarContainerRef,
    startTabDrag,
    startSidebarDrag
  }
}
