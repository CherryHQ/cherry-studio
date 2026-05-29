import { loggerService } from '@logger'
import { IpcChannel } from '@shared/IpcChannel'
import { useCallback, useEffect, useRef, useState } from 'react'

import type { Tab } from '../../hooks/useTabs'

const logger = loggerService.withContext('useTabDrag')

const DRAG_THRESHOLD = 5
const DETACH_THRESHOLD = 30
const TAB_GAP = 6

type DragMode = 'pending' | 'reorder' | 'detach'

interface DragState {
  tabId: string
  mode: DragMode
  insertIndex: number
}

interface UseTabDragOptions {
  pinnedTabs: Tab[]
  normalTabs: Tab[]
  isDetached: boolean
  reorderTabs: (type: 'pinned' | 'normal', oldIndex: number, newIndex: number) => void
  closeTab: (id: string) => void
  setActiveTab: (id: string) => void
}

export interface UseTabDragReturn {
  tabBarRef: React.RefObject<HTMLDivElement | null>
  tabRefs: React.MutableRefObject<Map<string, HTMLButtonElement>>
  noTransition: boolean
  getTranslateX: (tabId: string, tabType: 'pinned' | 'normal') => number
  handlePointerDown: (e: React.PointerEvent, tab: Tab, tabType: 'pinned' | 'normal') => void
  handleTabClick: (tabId: string) => void
  isDragging: (tabId: string) => boolean
  isGhost: (tabId: string) => boolean
}

export function useTabDrag({
  pinnedTabs,
  normalTabs,
  isDetached,
  reorderTabs,
  closeTab,
  setActiveTab
}: UseTabDragOptions): UseTabDragReturn {
  // Drag render state
  const [dragState, setDragState] = useState<DragState | null>(null)

  // Prevent animation flicker after reorder (disable transition for one frame)
  const [settling, setSettling] = useState(false)

  // High-frequency data (does not trigger re-render)
  const dragRef = useRef({
    pointerId: 0,
    startX: 0,
    startY: 0,
    currentX: 0,
    tabType: 'normal' as 'pinned' | 'normal',
    detachedCreated: false,
    tabClosed: false,
    originalRects: new Map<string, { left: number; width: number }>(),
    grabOffsetX: 0,
    grabOffsetY: 0
  })

  // Prevent onClick from firing after drag ends
  const didDragRef = useRef(false)

  const tabBarRef = useRef<HTMLDivElement>(null)
  const tabRefs = useRef<Map<string, HTMLButtonElement>>(new Map())
  const rafId = useRef<number | null>(null)

  // settling recovery
  useEffect(() => {
    if (settling) {
      const id = requestAnimationFrame(() => setSettling(false))
      return () => cancelAnimationFrame(id)
    }
    return undefined
  }, [settling])

  // Calculate insert index using original positions (skip the dragged tab)
  const calculateInsertIndex = useCallback(
    (clientX: number, dragTabId: string): number => {
      const list = dragRef.current.tabType === 'pinned' ? pinnedTabs : normalTabs
      const rects = dragRef.current.originalRects
      for (let i = 0; i < list.length; i++) {
        if (list[i].id === dragTabId) continue
        const rect = rects.get(list[i].id)
        if (rect && clientX < rect.left + rect.width / 2) {
          return i
        }
      }
      return list.length
    },
    [normalTabs, pinnedTabs]
  )

  // Calculate translateX for each tab
  const getTranslateX = useCallback(
    (tabId: string, tabType: 'pinned' | 'normal'): number => {
      if (!dragState || dragState.mode !== 'reorder' || dragRef.current.tabType !== tabType) return 0

      const list = tabType === 'pinned' ? pinnedTabs : normalTabs
      const draggedIndex = list.findIndex((t) => t.id === dragState.tabId)
      const currentIndex = list.findIndex((t) => t.id === tabId)
      const { insertIndex } = dragState

      if (tabId === dragState.tabId) {
        return dragRef.current.currentX - dragRef.current.startX
      }

      const draggedRect = dragRef.current.originalRects.get(dragState.tabId)
      if (!draggedRect) return 0
      const draggedWidth = draggedRect.width + TAB_GAP

      if (draggedIndex < insertIndex) {
        if (currentIndex > draggedIndex && currentIndex < insertIndex) return -draggedWidth
      } else if (draggedIndex > insertIndex) {
        if (currentIndex >= insertIndex && currentIndex < draggedIndex) return draggedWidth
      }

      return 0
    },
    [dragState, pinnedTabs, normalTabs]
  )

  // pointerdown
  const handlePointerDown = useCallback(
    (e: React.PointerEvent, tab: Tab, tabType: 'pinned' | 'normal') => {
      if (e.button !== 0) return
      if ((e.target as HTMLElement).closest('[role="button"]')) return

      const target = e.currentTarget as HTMLElement
      target.setPointerCapture(e.pointerId)

      const list = tabType === 'pinned' ? pinnedTabs : normalTabs
      const index = list.findIndex((t) => t.id === tab.id)

      // Store original positions of all tabs
      const originalRects = new Map<string, { left: number; width: number }>()
      for (const t of list) {
        const el = tabRefs.current.get(t.id)
        if (el) {
          const rect = el.getBoundingClientRect()
          originalRects.set(t.id, { left: rect.left, width: rect.width })
        }
      }

      dragRef.current = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        currentX: e.clientX,
        tabType,
        detachedCreated: false,
        tabClosed: false,
        originalRects,
        grabOffsetX: e.screenX - window.screenX,
        grabOffsetY: e.screenY - window.screenY
      }

      didDragRef.current = false
      setDragState({ tabId: tab.id, mode: 'pending', insertIndex: index })
    },
    [pinnedTabs, normalTabs]
  )

  // onClick debounce: prevent selection after drag ends
  const handleTabClick = useCallback(
    (tabId: string) => {
      if (didDragRef.current) {
        didDragRef.current = false
        return
      }
      setActiveTab(tabId)
    },
    [setActiveTab]
  )

  useEffect(() => {
    if (!dragState) return

    const onMove = (e: PointerEvent) => {
      if (e.pointerId !== dragRef.current.pointerId) return

      dragRef.current.currentX = e.clientX
      const deltaX = e.clientX - dragRef.current.startX
      const deltaY = e.clientY - dragRef.current.startY

      // Detached window: dragging tab = dragging the entire window
      if (isDetached) {
        const pastThreshold = Math.abs(deltaX) > DRAG_THRESHOLD || Math.abs(deltaY) > DRAG_THRESHOLD
        if (dragState.mode === 'pending' && pastThreshold) {
          setDragState((prev) => (prev ? { ...prev, mode: 'detach' } : null))
        }
        // Use pastThreshold as fallback to avoid losing the first frame due to mode still being pending in closure
        if (dragState.mode === 'detach' || pastThreshold) {
          if (rafId.current === null) {
            rafId.current = requestAnimationFrame(() => {
              window.electron.ipcRenderer.send(IpcChannel.Tab_MoveWindow, {
                tabId: dragState.tabId,
                x: e.screenX - dragRef.current.grabOffsetX,
                y: e.screenY - dragRef.current.grabOffsetY
              })
              rafId.current = null
            })
          }
        }
        return
      }

      // Main window logic
      const tabBarRect = tabBarRef.current?.getBoundingClientRect()
      if (!tabBarRect) return

      const isOutsideTabBar =
        e.clientY < tabBarRect.top - DETACH_THRESHOLD || e.clientY > tabBarRect.bottom + DETACH_THRESHOLD

      if (dragState.mode === 'pending') {
        if (isOutsideTabBar && Math.abs(deltaY) > DETACH_THRESHOLD) {
          setDragState((prev) => (prev ? { ...prev, mode: 'detach' } : null))
        } else if (Math.abs(deltaX) > DRAG_THRESHOLD) {
          setDragState((prev) => (prev ? { ...prev, mode: 'reorder' } : null))
        }
      } else if (dragState.mode === 'reorder') {
        if (isOutsideTabBar) {
          setDragState((prev) => (prev ? { ...prev, mode: 'detach' } : null))
        } else if (rafId.current === null) {
          rafId.current = requestAnimationFrame(() => {
            const newInsertIndex = calculateInsertIndex(dragRef.current.currentX, dragState.tabId)
            setDragState((prev) => (prev ? { ...prev, insertIndex: newInsertIndex } : null))
            rafId.current = null
          })
        }
      }

      // Detach mode: create/move window
      if (dragState.mode === 'detach' || (isOutsideTabBar && Math.abs(deltaY) > DETACH_THRESHOLD)) {
        if (!dragRef.current.detachedCreated) {
          const allTabs = [...pinnedTabs, ...normalTabs]
          const tab = allTabs.find((t) => t.id === dragState.tabId)
          if (tab) {
            window.electron.ipcRenderer.send(IpcChannel.Tab_Detach, {
              ...tab,
              x: e.screenX - 400,
              y: e.screenY - 20
            })
            dragRef.current.detachedCreated = true
            closeTab(dragState.tabId)
            dragRef.current.tabClosed = true
            didDragRef.current = true
          }
        } else if (!dragRef.current.tabClosed) {
          // Tab has been unmounted by closeTab, only update reorder state when not closed
        } else if (rafId.current === null) {
          // Tab has been closed, only need to move the new window
          rafId.current = requestAnimationFrame(() => {
            window.electron.ipcRenderer.send(IpcChannel.Tab_MoveWindow, {
              tabId: dragState.tabId,
              x: e.screenX - 400,
              y: e.screenY - 20
            })
            rafId.current = null
          })
        }
      }
    }

    const onUp = (e: PointerEvent) => {
      if (e.pointerId !== dragRef.current.pointerId) return

      const el = tabRefs.current.get(dragState.tabId)
      if (el) {
        try {
          el.releasePointerCapture(dragRef.current.pointerId)
        } catch {
          // Element may have been unmounted
        }
      }

      // Detached window: try to attach back to main window on pointer up
      if (isDetached && dragState.mode === 'detach') {
        didDragRef.current = true
        const allTabs = [...pinnedTabs, ...normalTabs]
        const tab = allTabs.find((t) => t.id === dragState.tabId)
        if (tab) {
          window.electron.ipcRenderer
            .invoke(IpcChannel.Tab_TryAttach, { tab, screenX: e.screenX, screenY: e.screenY })
            .catch((err: unknown) => {
              logger.debug(
                'Tab_TryAttach failed, window stays detached',
                err instanceof Error ? err : new Error(String(err))
              )
            })
        }
        setDragState(null)
        if (rafId.current !== null) {
          cancelAnimationFrame(rafId.current)
          rafId.current = null
        }
        return
      }

      if (dragState.mode === 'reorder') {
        didDragRef.current = true
        const list = dragRef.current.tabType === 'pinned' ? pinnedTabs : normalTabs
        const oldIndex = list.findIndex((t) => t.id === dragState.tabId)
        if (oldIndex !== -1 && oldIndex !== dragState.insertIndex) {
          const adjustedIndex = oldIndex < dragState.insertIndex ? dragState.insertIndex - 1 : dragState.insertIndex
          if (oldIndex !== adjustedIndex) {
            setSettling(true)
            reorderTabs(dragRef.current.tabType, oldIndex, adjustedIndex)
          }
        }
      } else if (dragState.mode === 'detach') {
        if (!dragRef.current.tabClosed && dragRef.current.tabType === 'normal') {
          closeTab(dragState.tabId)
        }
        window.electron.ipcRenderer.send(IpcChannel.Tab_DragEnd)
      }

      if (rafId.current !== null) {
        cancelAnimationFrame(rafId.current)
        rafId.current = null
      }
      setDragState(null)
    }

    document.addEventListener('pointermove', onMove)
    document.addEventListener('pointerup', onUp)
    return () => {
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerup', onUp)
      if (rafId.current !== null) {
        cancelAnimationFrame(rafId.current)
        rafId.current = null
      }
    }
  }, [dragState, pinnedTabs, normalTabs, calculateInsertIndex, reorderTabs, closeTab, isDetached])

  return {
    tabBarRef,
    tabRefs,
    noTransition: settling,
    getTranslateX,
    handlePointerDown,
    handleTabClick,
    isDragging: (tabId) => dragState?.tabId === tabId && dragState?.mode === 'reorder',
    isGhost: (tabId) => dragState?.tabId === tabId && dragState?.mode === 'detach'
  }
}
