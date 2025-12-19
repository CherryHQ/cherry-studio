import { useAppSelector } from '@renderer/store'
import type { PropsWithChildren } from 'react'
import React, { createContext, use, useCallback, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'

export type TabDragCandidate = {
  type: 'assistant' | 'topic'
  id: string
}

interface TabDragContextValue {
  candidate: TabDragCandidate | null
  isOverTabBar: boolean
  setCandidate: (candidate: TabDragCandidate | null) => void
  clearCandidate: () => void
  setIsOverTabBar: (isOver: boolean) => void
  openCandidateTab: (candidate: TabDragCandidate) => void
  openCandidateIfOverTabBar: () => boolean
}

const TabDragContext = createContext<TabDragContextValue>({
  candidate: null,
  isOverTabBar: false,
  setCandidate: () => {},
  clearCandidate: () => {},
  setIsOverTabBar: () => {},
  openCandidateTab: () => {},
  openCandidateIfOverTabBar: () => false
})

export const TabDragProvider: React.FC<PropsWithChildren> = ({ children }) => {
  const navigate = useNavigate()
  const tabs = useAppSelector((state) => state.tabs.tabs)
  const [candidate, setCandidateState] = useState<TabDragCandidate | null>(null)
  const [isOverTabBar, setIsOverTabBarState] = useState(false)
  const candidateRef = useRef<TabDragCandidate | null>(null)
  const isOverTabBarRef = useRef(false)

  const setCandidate = useCallback((nextCandidate: TabDragCandidate | null) => {
    candidateRef.current = nextCandidate
    setCandidateState((prev) => {
      if (!prev && !nextCandidate) return prev
      if (prev && nextCandidate && prev.id === nextCandidate.id && prev.type === nextCandidate.type) return prev
      return nextCandidate
    })
  }, [])

  const setIsOverTabBar = useCallback((isOver: boolean) => {
    isOverTabBarRef.current = isOver
    setIsOverTabBarState((prev) => (prev === isOver ? prev : isOver))
  }, [])

  const clearCandidate = useCallback(() => {
    candidateRef.current = null
    setCandidateState(null)
    setIsOverTabBar(false)
  }, [setIsOverTabBar])

  const openCandidateTab = useCallback(
    (targetCandidate: TabDragCandidate) => {
      const tabId = `${targetCandidate.type}:${targetCandidate.id}`
      const existingTab = tabs.find((tab) => tab.id === tabId)
      if (existingTab) {
        navigate(existingTab.path)
        return
      }

      const path =
        targetCandidate.type === 'assistant'
          ? `/chat/assistant/${targetCandidate.id}`
          : `/chat/topic/${targetCandidate.id}`
      navigate(path)
    },
    [navigate, tabs]
  )

  const openCandidateIfOverTabBar = useCallback(() => {
    const currentCandidate = candidateRef.current
    if (!currentCandidate || !isOverTabBarRef.current) {
      return false
    }
    openCandidateTab(currentCandidate)
    return true
  }, [openCandidateTab])

  const value = useMemo(
    () => ({
      candidate,
      isOverTabBar,
      setCandidate,
      clearCandidate,
      setIsOverTabBar,
      openCandidateTab,
      openCandidateIfOverTabBar
    }),
    [
      candidate,
      isOverTabBar,
      setCandidate,
      clearCandidate,
      setIsOverTabBar,
      openCandidateTab,
      openCandidateIfOverTabBar
    ]
  )

  return <TabDragContext value={value}>{children}</TabDragContext>
}

export const useTabDrag = () => use(TabDragContext)
