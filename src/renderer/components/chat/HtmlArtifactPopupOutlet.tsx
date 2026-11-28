import { lazy, Suspense } from 'react'

import {
  htmlArtifactPreviewRequiresInteractive,
  HtmlArtifactPreviewSurface
} from '@renderer/components/CodeBlockView/HtmlArtifactPreviewSurface'

import { useHtmlArtifactPopupContext } from './HtmlArtifactPopupContext'

const HtmlArtifactsPopup = lazy(() => import('@renderer/components/CodeBlockView/HtmlArtifactsPopup'))

export function HtmlArtifactPopupOutlet() {
  const popupContext = useHtmlArtifactPopupContext()
  const popupSession = popupContext.popupSession
  if (!popupSession) return null

  // Opening the full-screen popup is the explicit viewing action, so it never renders a
  // consent surface — active content (fragment or document) goes straight to the webview.
  const requiresInteractivePreview = htmlArtifactPreviewRequiresInteractive(popupSession.html)
  // Only a whole document may be promoted in the INLINE view after viewing, so the
  // approve-on-close memory stays kind-gated (fragments remain script-less inline).
  const approvesInlineInteractive = requiresInteractivePreview && popupSession.kind === 'document'

  return (
    <Suspense fallback={null}>
      <HtmlArtifactsPopup
        key={popupSession.artifactId}
        open
        title={popupSession.title}
        html={popupSession.html}
        onSave={popupSession.onSave}
        editable={popupSession.editable}
        // Maximize opens the interactive tier directly (upstream for documents, this
        // PR's extension for active fragments); the card path defers to View webpage.
        canCapturePreview={!requiresInteractivePreview}
        renderPreview={(iframeRef) => (
          <HtmlArtifactPreviewSurface
            html={popupSession.html}
            title={popupSession.title}
            authorized
            zoom={popupSession.zoom}
            iframeRef={iframeRef}
            forwardBoundaryWheel={false}
          />
        )}
        onClose={() => {
          if (approvesInlineInteractive) {
            popupContext.approveInteractiveHtml(popupSession.artifactId, popupSession.html)
          }
          popupContext.closePopup()
        }}
      />
    </Suspense>
  )
}
