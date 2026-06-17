import * as React from 'react'

export type PortalContainer = HTMLElement | null

const PortalContainerContext = React.createContext<PortalContainer>(null)

/**
 * Overlays should portal into the nearest provided container, usually dialog
 * content, so Radix focus traps and dismiss layers treat nested overlays as
 * inside the same interaction boundary.
 */
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
