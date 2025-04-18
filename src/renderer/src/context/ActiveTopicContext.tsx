import { useActiveTopic } from '@renderer/hooks/useTopic'
import { Topic } from '@renderer/types'
import React, { createContext, ReactNode, use, useMemo } from 'react'

type ActiveTopicContextType = {
  activeTopic: Topic
  setActiveTopic: (topic: Topic) => void
}

const ActiveTopicContext = createContext<ActiveTopicContextType | undefined>(undefined)

export const ActiveTopicProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const topicState = useActiveTopic()
  const value = useMemo(() => topicState, [topicState])

  return <ActiveTopicContext value={value}>{children}</ActiveTopicContext>
}

export const useActiveTopicContext = (): ActiveTopicContextType => {
  const context = use(ActiveTopicContext)
  if (context === undefined) {
    throw new Error('useActiveTopicContext must be used within an ActiveTopicProvider')
  }
  return context
}
