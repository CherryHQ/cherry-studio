import { lazy, type ReactNode, Suspense } from 'react'

import { HtmlArtifactPopupProvider, useHtmlArtifactPopupContext } from './HtmlArtifactPopupContext'

const HtmlArtifactPopupOutlet = lazy(() =>
  import('./HtmlArtifactPopupOutlet').then((module) => ({ default: module.HtmlArtifactPopupOutlet }))
)

function PopupOutlet() {
  const { popupSession } = useHtmlArtifactPopupContext()
  if (!popupSession) return null
  return (
    <Suspense fallback={null}>
      <HtmlArtifactPopupOutlet />
    </Suspense>
  )
}

export function HtmlArtifactPopupHost({ children }: { children: ReactNode }) {
  return (
    <HtmlArtifactPopupProvider>
      {children}
      <PopupOutlet />
    </HtmlArtifactPopupProvider>
  )
}
