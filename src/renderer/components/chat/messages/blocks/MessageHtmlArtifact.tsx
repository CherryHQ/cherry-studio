import { Skeleton } from '@cherrystudio/ui'
import { HtmlArtifactView } from '@renderer/components/chat/HtmlArtifactView'
import { extractHtmlTitle } from '@renderer/utils/formats'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'

interface MessageHtmlArtifactProps {
  html: string
  isStreaming: boolean
}

const HtmlArtifactGeneratingPlaceholder = memo(function HtmlArtifactGeneratingPlaceholder({
  label
}: {
  label: string
}) {
  return (
    <div
      data-testid="html-artifact-generating-placeholder"
      role="status"
      className="relative w-full overflow-hidden rounded-xl bg-background-subtle p-5">
      <div className="flex items-center gap-2 text-foreground-muted text-xs">
        <span className="size-1.5 animate-pulse rounded-full bg-primary" />
        <span>{label}</span>
      </div>

      <div aria-hidden="true" className="mt-7 space-y-5">
        <div className="space-y-2.5">
          <Skeleton className="h-6 w-2/5 rounded-md" />
          <Skeleton className="h-3 w-3/4 rounded-full opacity-70" />
          <Skeleton className="h-3 w-1/2 rounded-full opacity-50" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Skeleton className="h-12 w-full rounded-lg" />
          <Skeleton className="h-12 w-full rounded-lg" />
        </div>
        <Skeleton className="h-16 w-full rounded-lg opacity-70" />
      </div>
    </div>
  )
})

export const MessageHtmlArtifact = memo(function MessageHtmlArtifact({ html, isStreaming }: MessageHtmlArtifactProps) {
  const { t } = useTranslation()

  return (
    <div
      data-html-artifact=""
      data-testid="message-html-artifact"
      className="message-html-artifact special-preview mt-0 mb-2.5 w-full min-w-0 max-w-full">
      {isStreaming ? (
        <HtmlArtifactGeneratingPlaceholder label={t('html_artifacts.generating')} />
      ) : (
        <HtmlArtifactView html={html} title={extractHtmlTitle(html) || t('common.html_preview')} />
      )}
    </div>
  )
})
