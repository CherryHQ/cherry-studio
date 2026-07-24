import { Button, Tooltip } from '@cherrystudio/ui'
import { Icon } from '@iconify/react'
import { loggerService } from '@logger'
import { toast } from '@renderer/services/toast'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import { extractHtmlTitle, getFileNameFromHtmlTitle } from '@renderer/utils/formats'
import { DownloadIcon, LinkIcon } from 'lucide-react'
import type { FC } from 'react'
import { lazy, Suspense, useState } from 'react'
import { useTranslation } from 'react-i18next'

const HtmlArtifactsPopup = lazy(() => import('./HtmlArtifactsPopup'))

const logger = loggerService.withContext('HtmlArtifactsCard')

interface Props {
  html: string
  onSave?: (html: string) => void
  editable?: boolean
  isStreaming?: boolean
}

const HtmlArtifactsCard: FC<Props> = ({ html, onSave, editable = true, isStreaming = false }) => {
  const { t } = useTranslation()
  const title = extractHtmlTitle(html) || t('common.html_preview')
  const [isPopupOpen, setIsPopupOpen] = useState(false)

  const htmlContent = html || ''
  const hasContent = htmlContent.trim().length > 0

  const handleOpenExternal = async () => {
    try {
      const tempPath = await window.api.file.createTempFile('artifacts-preview.html')
      await window.api.file.write(tempPath, htmlContent)
      await window.api.file.openPath(tempPath)
    } catch (error) {
      logger.error('Failed to open HTML artifact externally', error as Error)
      toast.error(formatErrorMessageWithPrefix(error, t('chat.artifacts.preview.openExternal.error.content')))
    }
  }

  const handleDownload = async () => {
    try {
      const fileName = `${getFileNameFromHtmlTitle(title) || 'html-artifact'}.html`
      const savedPath = await window.api.file.save(fileName, htmlContent)
      if (!savedPath) return

      toast.success(t('message.download.success'))
    } catch (error) {
      logger.error('Failed to download HTML artifact', error as Error)
      toast.error(formatErrorMessageWithPrefix(error, t('message.download.failed')))
    }
  }

  return (
    <>
      <div className="special-preview mt-0 mb-2.5 flex w-full max-w-xl items-center overflow-hidden rounded-lg border-[0.5px] border-border bg-background-subtle font-[var(--font-family-body)] transition-colors hover:bg-accent">
        <button
          type="button"
          aria-label={t('chat.artifacts.button.preview')}
          title={title}
          disabled={!hasContent}
          onClick={() => setIsPopupOpen(true)}
          className="flex min-h-12 min-w-0 flex-1 items-center gap-2.5 border-0 bg-transparent px-2.5 py-2 text-left disabled:cursor-default">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-background">
            <Icon icon="material-icon-theme:html" className="text-[20px]" />
          </span>
          <span className="min-w-0 truncate font-medium text-[13px] text-foreground leading-5">{title}</span>
          {isStreaming ? (
            <span className="flex shrink-0 items-center gap-1.5 text-foreground-muted text-xs">
              <span className="size-1.5 animate-pulse rounded-full bg-primary" />
              {t('html_artifacts.generating', 'Generating content...')}
            </span>
          ) : (
            <span className="shrink-0 rounded-sm bg-background px-1.5 py-0.5 font-medium text-[10px] text-foreground-muted leading-4">
              HTML
            </span>
          )}
        </button>

        {!isStreaming && (
          <div className="mr-2 flex shrink-0 items-center gap-0.5">
            <Tooltip content={t('chat.artifacts.button.openExternal')} delay={500}>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="size-7 text-foreground-muted opacity-70 hover:bg-background hover:text-foreground hover:opacity-100"
                aria-label={t('chat.artifacts.button.openExternal')}
                disabled={!hasContent}
                onClick={handleOpenExternal}>
                <LinkIcon size={15} />
              </Button>
            </Tooltip>
            <Tooltip content={t('code_block.download.label')} delay={500}>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="size-7 text-foreground-muted opacity-70 hover:bg-background hover:text-foreground hover:opacity-100"
                aria-label={t('code_block.download.label')}
                disabled={!hasContent}
                onClick={handleDownload}>
                <DownloadIcon size={15} />
              </Button>
            </Tooltip>
          </div>
        )}
      </div>

      {isPopupOpen ? (
        <Suspense fallback={null}>
          <HtmlArtifactsPopup
            open={isPopupOpen}
            title={title}
            html={htmlContent}
            onSave={onSave}
            editable={editable}
            onClose={() => setIsPopupOpen(false)}
          />
        </Suspense>
      ) : null}
    </>
  )
}

export default HtmlArtifactsCard
