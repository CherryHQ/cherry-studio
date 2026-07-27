import { HtmlArtifactView } from '@renderer/components/chat/HtmlArtifactView'
import { extractHtmlTitle } from '@renderer/utils/formats'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'

interface MessageHtmlArtifactProps {
  html: string
}

export const MessageHtmlArtifact = memo(function MessageHtmlArtifact({ html }: MessageHtmlArtifactProps) {
  const { t } = useTranslation()

  return (
    <div
      data-html-artifact=""
      data-testid="message-html-artifact"
      className="message-html-artifact special-preview mt-0 mb-2.5 w-full min-w-0 max-w-full">
      <HtmlArtifactView html={html} title={extractHtmlTitle(html) || t('common.html_preview')} />
    </div>
  )
})
