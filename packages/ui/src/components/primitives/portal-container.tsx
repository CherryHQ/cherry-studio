import * as React from 'react'

export type PortalContainer = HTMLElement | null

const PortalContainerContext = React.createContext<PortalContainer>(null)
const TooltipPortalContainerContext = React.createContext<PortalContainer>(null)
const DialogPortalContainerContext = React.createContext<PortalContainer>(null)

/**
 * Overlays should portal into the nearest provided container, usually dialog
 * content, so Radix focus traps and dismiss layers treat nested overlays as
 * inside the same interaction boundary.
 *
 * @param tooltipContainer - Portal target for tooltips, which never take focus and so
 *   can live outside a container that clips them. Defaults to `container`.
 */
export function PortalContainerProvider({
  container,
  tooltipContainer = container,
  children
}: {
  container: PortalContainer
  tooltipContainer?: PortalContainer
  children: React.ReactNode
}) {
  return (
    <PortalContainerContext value={container}>
      <TooltipPortalContainerContext value={tooltipContainer}>{children}</TooltipPortalContainerContext>
    </PortalContainerContext>
  )
}

export function usePortalContainer(): PortalContainer {
  return React.use(PortalContainerContext)
}

export function useTooltipPortalContainer(): PortalContainer {
  return React.use(TooltipPortalContainerContext)
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
