import type { ReactNode } from 'react'
import { createContext, use } from 'react'

const SelectorPortalContainerContext = createContext<HTMLElement | null>(null)

export function SelectorPortalContainerProvider({
  container,
  children
}: {
  container: HTMLElement | null
  children: ReactNode
}) {
  return <SelectorPortalContainerContext value={container}>{children}</SelectorPortalContainerContext>
}

export function useSelectorPortalContainer(): HTMLElement | null {
  return use(SelectorPortalContainerContext)
}
