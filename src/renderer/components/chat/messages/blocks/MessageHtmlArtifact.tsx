import { memo } from 'react'
import { useTranslation } from 'react-i18next'

import { HtmlArtifactView } from '@renderer/components/chat/HtmlArtifactView'
import type { HtmlArtifactKind } from '@renderer/components/chat/messages/markdown/plugins/remarkHtmlArtifact'
import { extractHtmlTitle } from '@renderer/utils/formats'

interface MessageHtmlArtifactProps {
  artifactId: string
  html: string
  onSave?: (html: string) => void
  editable?: boolean
  /** Defaults to the gated `document` path so a missing classification can never open the preview up. */
  kind?: HtmlArtifactKind
  isStreaming?: boolean
}

export const MessageHtmlArtifact = memo(function MessageHtmlArtifact({
  artifactId,
  html,
  onSave,
  editable = false,
  kind = 'document',
  isStreaming = false
}: MessageHtmlArtifactProps) {
  const { t } = useTranslation()

  return (
    <div
      data-html-artifact=""
      data-testid="message-html-artifact"
      className="message-html-artifact special-preview mt-0 mb-2.5 w-full max-w-full min-w-0">
      <HtmlArtifactView
        artifactId={artifactId}
        html={html}
        title={extractHtmlTitle(html) || t('common.html_preview')}
        onSave={onSave}
        editable={editable}
        kind={kind}
        isStreaming={isStreaming}
      />
    </div>
  )
})
