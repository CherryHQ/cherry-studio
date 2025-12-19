import { useAppSelector } from '@renderer/store'
import type { PropsWithChildren } from 'react'
import React, { createContext, use, useCallback, useMemo, useState } from 'react'
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
}

const TabDragContext = createContext<TabDragContextValue>({
  candidate: null,
  isOverTabBar: false,
  setCandidate: () => {},
  clearCandidate: () => {},
  setIsOverTabBar: () => {},
  openCandidateTab: () => {}
})

export const TabDragProvider: React.FC<PropsWithChildren> = ({ children }) => {
  const navigate = useNavigate()
  const tabs = useAppSelector((state) => state.tabs.tabs)
  const [candidate, setCandidate] = useState<TabDragCandidate | null>(null)
  const [isOverTabBar, setIsOverTabBar] = useState(false)

  const clearCandidate = useCallback(() => setCandidate(null), [])

  const openCandidateTab = useCallback(
    (candidate: TabDragCandidate) => {
      const tabId = `${candidate.type}:${candidate.id}`
      const existingTab = tabs.find((tab) => tab.id === tabId)
      if (existingTab) {
        navigate(existingTab.path)
        return
      }

      const path = candidate.type === 'assistant' ? `/chat/assistant/${candidate.id}` : `/chat/topic/${candidate.id}`
      navigate(path)
    },
    [navigate, tabs]
  )

  const value = useMemo(
    () => ({
      candidate,
      isOverTabBar,
      setCandidate,
      clearCandidate,
      setIsOverTabBar,
      openCandidateTab
    }),
    [candidate, isOverTabBar, clearCandidate, openCandidateTab]
  )

  return <TabDragContext value={value}>{children}</TabDragContext>
}

export const useTabDrag = () => use(TabDragContext)
