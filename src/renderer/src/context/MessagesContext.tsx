import { createContext } from 'react'

type MessagesContextType = {
  scrollTop: number
  scrollTo: (top: number) => void
}

export const MessagesContext = createContext<MessagesContextType>({ scrollTop: 0, scrollTo: () => {} })
