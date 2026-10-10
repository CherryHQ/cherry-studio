import * as React from 'react'

export type PortalContainer = HTMLElement | null

const PortalContainerContext = React.createContext<PortalContainer>(null)
const DialogPortalContainerContext = React.createContext<PortalContainer>(null)

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

/**
 * Dialogs use a page-level portal target so they remain attached to their owning
 * tab without inheriting the transformed content node of a parent dialog.
 */
export function DialogPortalContainerProvider({
  container,
  children
}: {
  container: PortalContainer
  children: React.ReactNode
}) {
  return <DialogPortalContainerContext value={container}>{children}</DialogPortalContainerContext>
}

export function useDialogPortalContainer(): PortalContainer {
  return React.use(DialogPortalContainerContext)
}
