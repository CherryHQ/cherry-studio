import { Button } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import { loggerService } from '@logger'
import { extractHtmlTitle, getFileNameFromHtmlTitle } from '@renderer/utils/formats'
import { Code, DownloadIcon, Globe, LinkIcon, Sparkles } from 'lucide-react'
import type { FC } from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ClipLoader } from 'react-spinners'

import HtmlArtifactsPopup from './HtmlArtifactsPopup'

const logger = loggerService.withContext('HtmlArtifactsCard')

interface Props {
  html: string
  onSave?: (html: string) => void
  isStreaming?: boolean
}

const HtmlArtifactsCard: FC<Props> = ({ html, onSave, isStreaming = false }) => {
  const { t } = useTranslation()
  const title = extractHtmlTitle(html) || 'HTML Artifacts'
  const [isPopupOpen, setIsPopupOpen] = useState(false)

  const htmlContent = html || ''
  const hasContent = htmlContent.trim().length > 0

  const handleOpenExternal = async () => {
    const path = await window.api.file.createTempFile('artifacts-preview.html')
    await window.api.file.write(path, htmlContent)
    const filePath = `file://${path}`

    if (window.api.shell?.openExternal) {
      void window.api.shell.openExternal(filePath)
    } else {
      logger.error(t('chat.artifacts.preview.openExternal.error.content'))
    }
  }

  const handleDownload = async () => {
    const fileName = `${getFileNameFromHtmlTitle(title) || 'html-artifact'}.html`
    await window.api.file.save(fileName, htmlContent)
    window.toast.success(t('message.download.success'))
  }

  return (
    <>
      <div className="mt-0 mb-2.5 overflow-hidden rounded-md border border-border bg-background">
        <div className="flex items-center gap-3 rounded-t-md border-border border-b bg-muted/50 px-6 pt-5 pb-4">
          <div
            className={cn(
              'flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-white shadow-sm transition-colors',
              isStreaming
                ? 'bg-linear-to-br from-amber-500 to-amber-600 shadow-amber-500/30'
                : 'bg-linear-to-br from-blue-500 to-blue-700 shadow-blue-500/30'
            )}>
            {isStreaming ? <Sparkles size={20} /> : <Globe size={20} />}
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <span className="truncate font-['Ubuntu'] font-bold text-foreground text-sm leading-snug">{title}</span>
            <div className="inline-flex w-fit items-center gap-1 rounded-md border border-border bg-muted px-1.5 py-0.75 font-medium text-[10px] text-muted-foreground">
              <Code size={12} />
              <span>HTML</span>
            </div>
          </div>
        </div>

        <div className="bg-background">
          {isStreaming && !hasContent ? (
            <div className="flex min-h-[78px] items-center justify-center gap-2 p-5">
              <ClipLoader size={20} color="var(--color-primary)" />
              <div className="text-muted-foreground text-sm">
                {t('html_artifacts.generating', 'Generating content...')}
              </div>
            </div>
          ) : isStreaming && hasContent ? (
            <>
              <div className="m-4 overflow-hidden rounded-md bg-muted font-mono dark:bg-neutral-900">
                <div className="min-h-20 bg-muted p-3 text-[13px] text-foreground leading-relaxed dark:bg-neutral-900 dark:text-neutral-300">
                  <div className="flex items-start gap-2">
                    <span className="shrink-0 font-bold text-green-700 dark:text-green-400">$</span>
                    <span className="flex-1 whitespace-pre-wrap break-words bg-transparent text-foreground dark:text-neutral-300">
                      {htmlContent.trim().split('\n').slice(-3).join('\n')}
                      <span className="ml-0.5 inline-block h-4 w-0.5 animate-pulse bg-green-700 dark:bg-green-400" />
                    </span>
                  </div>
                </div>
              </div>
              <div className="m-[10px_16px] flex flex-row gap-2">
                <Button onClick={() => setIsPopupOpen(true)}>
                  <Code size={14} />
                  {t('chat.artifacts.button.preview')}
                </Button>
              </div>
            </>
          ) : (
            <div className="m-[10px_16px] flex flex-row gap-2">
              <Button onClick={() => setIsPopupOpen(true)} variant="ghost" disabled={!hasContent}>
                <Code size={14} />
                {t('chat.artifacts.button.preview')}
              </Button>
              <Button onClick={handleOpenExternal} variant="ghost" disabled={!hasContent}>
                <LinkIcon size={14} />
                {t('chat.artifacts.button.openExternal')}
              </Button>
              <Button onClick={handleDownload} variant="ghost" disabled={!hasContent}>
                <DownloadIcon size={14} />
                {t('code_block.download.label')}
              </Button>
            </div>
          )}
        </div>
      </div>

      <HtmlArtifactsPopup
        open={isPopupOpen}
        title={title}
        html={htmlContent}
        onSave={onSave}
        onClose={() => setIsPopupOpen(false)}
      />
    </>
  )
}

export default HtmlArtifactsCard
