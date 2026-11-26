import { Check, Copy, Image, NotebookPen, Volume2 } from 'lucide-react'
import type { Ref } from 'react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, ScrollArea } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { AppMarkdown } from '@renderer/components/markdown'
import { toast } from '@renderer/services/toast'
import { readTextAloud } from '@renderer/services/voice'

import IconButton from './IconButton'

const logger = loggerService.withContext('TranslateOutputPane')

type Props = {
  ref?: Ref<HTMLDivElement>
  translatedContent: string
  enableMarkdown: boolean
  translating: boolean
  copied: boolean
  onCopy: () => void
  onExportToNotes: () => void
  onScroll: () => void
}

const TranslateOutputPane = ({
  ref,
  translatedContent,
  enableMarkdown,
  translating,
  copied,
  onCopy,
  onExportToNotes,
  onScroll
}: Props) => {
  const { t } = useTranslation()
  const captureRef = useRef<HTMLDivElement>(null)
  const imageCopyInFlight = useRef(false)
  const imageCopyRevision = useRef(0)
  const [copyingImage, setCopyingImage] = useState(false)
  useLayoutEffect(() => {
    imageCopyRevision.current += 1
  }, [translatedContent, translating, enableMarkdown])
  const readButtonRef = useRef<HTMLButtonElement>(null)
  const currentResultRef = useRef({ translatedContent, translating })
  currentResultRef.current = { translatedContent, translating }
  const playbackRef = useRef<AbortController | undefined>(undefined)
  useLayoutEffect(() => () => playbackRef.current?.abort(), [translatedContent, translating])
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const copyImage = async () => {
    if (imageCopyInFlight.current || translating || !translatedContent.trim()) return
    imageCopyInFlight.current = true
    setCopyingImage(true)
    const revision = imageCopyRevision.current
    const isCurrent = () => mountedRef.current && imageCopyRevision.current === revision
    try {
      const [{ exportService }, { copyImageToClipboard }] = await Promise.all([
        import('@renderer/services/ExportService'),
        import('@renderer/utils/image')
      ])
      if (!isCurrent()) return
      // Flatten the translucent window surface onto an opaque themed export backdrop.
      const dataUrl = await exportService.captureScrollableAsDataUrl(captureRef, '--card')
      if (!isCurrent()) return
      if (!dataUrl) throw new Error('Translation image capture returned no image')
      await copyImageToClipboard(dataUrl)
      if (isCurrent()) toast.success(t('message.copied'))
    } catch (error) {
      if (isCurrent()) {
        logger.error('Failed to copy translation as image', error as Error)
        toast.error(t('common.copy_failed'))
      }
    } finally {
      imageCopyInFlight.current = false
      if (mountedRef.current) setCopyingImage(false)
    }
  }

  return (
    <div data-ui="translate.output" className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <ScrollArea
        viewportProps={{ ref: ref, onScroll: onScroll, className: 'overflow-x-hidden' }}
        className="selectable min-h-0 flex-1 text-base leading-relaxed">
        <div
          ref={captureRef}
          data-ui="translate.output-content"
          className="flex min-h-full flex-col p-4 pr-12 text-foreground">
          {translating && !translatedContent ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground" />
              <span>{t('translate.processing')}</span>
            </div>
          ) : translatedContent ? (
            enableMarkdown ? (
              <AppMarkdown isStreaming={translating}>{translatedContent}</AppMarkdown>
            ) : (
              <div className="wrap-break-word whitespace-pre-wrap text-foreground">{translatedContent}</div>
            )
          ) : null}
        </div>
      </ScrollArea>
      <div className="absolute top-4 right-3 flex">
        <IconButton size="sm" onClick={onCopy} disabled={!translatedContent} aria-label={t('common.copy')}>
          {copied ? <Check size={14} className="text-foreground" /> : <Copy size={14} />}
        </IconButton>
      </div>
      <div className="flex shrink-0 items-center px-3 py-4">
        {translatedContent && <span className="text-foreground-tertiary text-xs">{translatedContent.length}</span>}
        <Button
          ref={readButtonRef}
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={t('chat.message.read_aloud.label')}
          disabled={translating || !translatedContent.trim()}
          className="ml-auto text-muted-foreground"
          onClick={() => {
            playbackRef.current?.abort()
            const controller = new AbortController()
            playbackRef.current = controller
            void readTextAloud({
              text: translatedContent,
              mode: 'document',
              sourceLabel: 'document',
              sourceEntityId: 'translate-page-result',
              signal: controller.signal,
              isCurrent: () =>
                mountedRef.current &&
                !currentResultRef.current.translating &&
                currentResultRef.current.translatedContent === translatedContent,
              focusOnClose: () => readButtonRef.current?.focus()
            })
          }}>
          <Volume2 className="size-4" />
        </Button>
        <IconButton
          size="sm"
          onClick={() => void copyImage()}
          disabled={translating || !translatedContent.trim() || copyingImage}
          aria-label={t('preview.copy.image')}
          aria-busy={copyingImage}
          className="ml-1">
          <Image size={14} />
        </IconButton>
        <IconButton
          size="sm"
          onClick={onExportToNotes}
          disabled={!translatedContent.trim()}
          aria-label={t('notes.save')}
          className="ml-1">
          <NotebookPen size={14} />
        </IconButton>
      </div>
    </div>
  )
}

export default TranslateOutputPane
