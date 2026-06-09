import * as React from 'react'

export type PortalContainer = HTMLElement | null

const PortalContainerContext = React.createContext<PortalContainer>(null)

export function PortalContainerProvider({
  container,
  children
}: {
  container: PortalContainer
  children: React.ReactNode
}) {
  return <PortalContainerContext value={container}>{children}</PortalContainerContext>
}

export function usePortalContainer(): PortalContainer {
  return React.use(PortalContainerContext)
}
