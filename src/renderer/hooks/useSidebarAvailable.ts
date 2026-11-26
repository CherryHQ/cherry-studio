import { createContext, use } from 'react'

export const SidebarAvailableContext = createContext(true)

export function useSidebarAvailable() {
  return use(SidebarAvailableContext)
}
