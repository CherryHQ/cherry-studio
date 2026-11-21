import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { PreviewError } from '@cherrystudio/file-preview/core'
import { FilePreviewLayout } from '@cherrystudio/file-preview/react'
import { Button } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { toast } from '@renderer/services/toast'
import { safeOpen } from '@renderer/utils/file/safeOpen'
import { createFilePathHandle } from '@shared/utils/file'

import { createElectronPreviewSource } from '../../electronPreviewSource'
import type { FilePreviewPluginProps } from '../../types'
import {
  EPUB_SOURCE_MAX_BYTES,
  EpubError,
  type EpubBook,
  type EpubChapterContent,
  type EpubFailureReason,
  openEpub
} from './epubParser'

const logger = loggerService.withContext('EpubFilePreview')
type Reason = EpubFailureReason | 'source_changed' | 'closed'
type State = { status: 'loading' } | { status: 'ready'; book: EpubBook } | { status: 'error'; reason: Reason }
const errorKeys = {
  damaged: ['file_preview.epub.damaged.title', 'file_preview.epub.damaged.description'],
  unsupported_structure: [
    'file_preview.epub.unsupported_structure.title',
    'file_preview.epub.unsupported_structure.description'
  ],
  encrypted: ['file_preview.epub.encrypted.title', 'file_preview.epub.encrypted.description'],
  too_large: ['file_preview.epub.too_large.title', 'file_preview.epub.too_large.description'],
  chapter_empty: ['file_preview.epub.chapter_empty.title', 'file_preview.epub.chapter_empty.description'],
  source_changed: ['file_preview.load_error.title', 'file_preview.load_error.description'],
  closed: ['file_preview.load_error.title', 'file_preview.load_error.description']
} as const
type ChapterState =
  | { status: 'loading' }
  | { status: 'ready'; content: EpubChapterContent }
  | { status: 'error'; reason: Reason }
function reasonFor(error: unknown): Reason {
  if (error instanceof EpubError) return error.reason
  if (
    error instanceof PreviewError &&
    (error.code === 'too_large' || error.code === 'source_changed' || error.code === 'closed')
  )
    return error.code
  return 'damaged'
}

export default function EpubFilePreview({
  filePath,
  fileName,
  metadata,
  metadataRequest,
  refreshKey
}: FilePreviewPluginProps) {
  const { t } = useTranslation()
  const [state, setState] = useState<State>({ status: 'loading' })
  const [selected, setSelected] = useState('0')
  const [titles, setTitles] = useState<Record<string, string>>({})
  const [chapter, setChapter] = useState<ChapterState>({ status: 'loading' })
  useEffect(() => {
    const controller = new AbortController()
    let active = true
    let book: EpubBook | undefined
    setState({ status: 'loading' })
    setSelected('0')
    setTitles({})
    const load = async () => {
      const source = createElectronPreviewSource(filePath, fileName, metadataRequest ?? metadata)
      const session = await source.open(controller.signal)
      try {
        if (session.size > EPUB_SOURCE_MAX_BYTES) throw new EpubError('too_large')
        const bytes = await session.readRange(0, session.size, controller.signal)
        controller.signal.throwIfAborted()
        book = await openEpub(bytes)
        if (active) setState({ status: 'ready', book })
        else book.close()
      } finally {
        await session.close()
      }
    }
    void load().catch((error: unknown) => {
      logger.error('Failed to load EPUB', error instanceof Error ? error : { error })
      if (active) setState({ status: 'error', reason: reasonFor(error) })
    })
    return () => {
      controller.abort()
      active = false
      book?.close()
    }
  }, [filePath, fileName, metadata, metadataRequest, refreshKey])
  useEffect(() => {
    if (state.status !== 'ready') return
    let active = true
    setChapter({ status: 'loading' })
    void state.book
      .readChapter(selected)
      .then((content) => {
        if (!active) return
        setChapter({ status: 'ready', content })
        if (content.title) setTitles((previous) => ({ ...previous, [selected]: content.title! }))
      })
      .catch((error: unknown) => {
        logger.error('Failed to read EPUB chapter', error instanceof Error ? error : { error })
        if (active) setChapter({ status: 'error', reason: reasonFor(error) })
      })
    return () => {
      active = false
    }
  }, [state, selected])
  const open = () => {
    void safeOpen(createFilePathHandle(filePath)).catch((error: unknown) => {
      logger.error('Failed to open EPUB', error instanceof Error ? error : { error })
      toast.error(t('file_preview.open_error'))
    })
  }
  const errorView = (reason: Reason | 'chapter_empty') => {
    const [title, description] = errorKeys[reason]
    return (
      <div role="alert" className="flex flex-col items-start gap-3 p-4">
        <h2>{t(title)}</h2>
        <p>{t(description, { limit: EPUB_SOURCE_MAX_BYTES / 1024 / 1024 })}</p>
        <Button onClick={open}>{t('file_preview.unsupported.action')}</Button>
      </div>
    )
  }
  return (
    <FilePreviewLayout.Frame>
      <div className="border-b px-4 py-2 text-sm text-muted-foreground">{t('file_preview.epub.text_only')}</div>
      <FilePreviewLayout.Content>
        {state.status === 'loading' ? (
          <div role="status">{t('file_preview.loading')}</div>
        ) : state.status === 'error' ? (
          errorView(state.reason)
        ) : (
          <div className="flex min-h-full">
            <nav aria-label={t('file_preview.epub.chapters')} className="w-48 shrink-0 border-r p-2">
              {state.book.chapters.map((item, index) => (
                <Button
                  key={item.id}
                  variant={selected === item.id ? 'secondary' : 'ghost'}
                  className="w-full justify-start"
                  onClick={() => setSelected(item.id)}>
                  {titles[item.id] ?? t('file_preview.epub.chapter_fallback', { number: index + 1 })}
                </Button>
              ))}
            </nav>
            <article className="select-text min-w-0 flex-1 whitespace-pre-wrap p-4">
              {chapter.status === 'loading' ? (
                <div role="status">{t('file_preview.loading')}</div>
              ) : chapter.status === 'error' ? (
                errorView(chapter.reason)
              ) : chapter.content.paragraphs.length ? (
                chapter.content.paragraphs.map((paragraph, index) => (
                  <p className="mb-4" key={index}>
                    {paragraph}
                  </p>
                ))
              ) : (
                errorView('chapter_empty')
              )}
            </article>
          </div>
        )}
      </FilePreviewLayout.Content>
    </FilePreviewLayout.Frame>
  )
}
