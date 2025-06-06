import { Assistant, Topic } from '@renderer/types'
import { createContext, use } from 'react'

const TabContext = createContext({} as Props)

interface Props {
  assistant: Assistant
  activeTopic: Topic
  setActiveTopic: (topic: Topic) => void
  children?: React.ReactNode
}

export const useTabContext = (): Props => {
  return use(TabContext)
}

export default function TabsProvider(props: Props) {
  return <TabContext value={props}>{props?.children}</TabContext>
}
