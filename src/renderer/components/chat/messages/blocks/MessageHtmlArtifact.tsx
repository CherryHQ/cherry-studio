import { HtmlArtifactView } from '@renderer/components/chat/HtmlArtifactView'
import type { HtmlArtifactKind } from '@renderer/components/chat/messages/markdown/plugins/remarkHtmlArtifact'
import { extractHtmlTitle } from '@renderer/utils/formats'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'

interface MessageHtmlArtifactProps {
  html: string
  onSave?: (html: string) => void
  editable?: boolean
  /** Defaults to the gated `document` path so a missing classification can never open the preview up. */
  kind?: HtmlArtifactKind
  isStreaming?: boolean
}

export const MessageHtmlArtifact = memo(function MessageHtmlArtifact({
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
      className="message-html-artifact special-preview mt-0 mb-2.5 w-full min-w-0 max-w-full">
      <HtmlArtifactView
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
