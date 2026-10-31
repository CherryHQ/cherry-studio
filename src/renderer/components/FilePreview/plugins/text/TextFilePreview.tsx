import FileText from 'lucide-react/dist/esm/icons/file-text'
import FileWarning from 'lucide-react/dist/esm/icons/file-warning'
import LoaderCircle from 'lucide-react/dist/esm/icons/loader-circle'
import { lazy, type ReactNode, Suspense, useLayoutEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { FilePreviewLayout } from '@cherrystudio/file-preview/react'
import { EmptyState } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { FILE_EDIT_MAX_SIZE_BYTES } from '@shared/types/file'

import type { FilePreviewPluginProps } from '../../types'

const logger = loggerService.withContext('TextFilePreview')
const FileEditor = lazy(() => import('@renderer/components/FileEditor'))
const TEXT_PREVIEW_MAX_SIZE_MIB = FILE_EDIT_MAX_SIZE_BYTES / (1024 * 1024)

type TextFileLoadState =
  | { status: 'empty' }
  | { status: 'error'; error: Error }
  | { status: 'loading' }
  | { status: 'ready'; content: string }
  | { status: 'too_large' }

function TextPreviewLoading() {
  const { t } = useTranslation()

  return (
    <div role="status" className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
      <LoaderCircle className="size-4 animate-spin" aria-hidden />
      <span>{t('file_preview.loading')}</span>
    </div>
  )
}

function TextPreviewEmpty() {
  const { t } = useTranslation()

  return (
    <div role="status" className="h-full">
      <EmptyState
        icon={FileText}
        title={t('file_preview.text.empty.title')}
        description={t('file_preview.text.empty.description')}
        className="h-full"
      />
    </div>
  )
}

function TextPreviewTooLarge() {
  const { t } = useTranslation()

  return (
    <div role="alert" className="h-full">
      <EmptyState
        icon={FileWarning}
        title={t('file_preview.text.too_large.title')}
        description={t('file_preview.text.too_large.description', { limit: TEXT_PREVIEW_MAX_SIZE_MIB })}
        className="h-full"
      />
    </div>
  )
}

function TextPreviewError() {
  const { t } = useTranslation()

  return (
    <div role="alert" className="h-full">
      <EmptyState
        icon={FileWarning}
        title={t('file_preview.text.read_error.title')}
        description={t('file_preview.load_error.description')}
        className="h-full"
      />
    </div>
  )
}

interface TextPreviewContentProps {
  filePath: string
  loadState: TextFileLoadState
  onLineComment?: FilePreviewPluginProps['onLineComment']
}

function TextPreviewContent({ filePath, loadState, onLineComment }: TextPreviewContentProps): ReactNode {
  if (loadState.status === 'loading') return <TextPreviewLoading />
  if (loadState.status === 'empty') return <TextPreviewEmpty />
  if (loadState.status === 'too_large') return <TextPreviewTooLarge />
  if (loadState.status === 'error') return <TextPreviewError />

  return (
    <div className="flex min-h-full w-full">
      <Suspense fallback={<TextPreviewLoading />}>
        <FileEditor
          value={loadState.content}
          fileName={filePath}
          readOnly
          expanded
          wrapLines
          onLineComment={onLineComment}
          className="min-w-0 flex-1"
        />
      </Suspense>
    </div>
  )
}

export default function TextFilePreview({
  filePath,
  metadata,
  metadataRequest,
  refreshKey,
  onLineComment
}: FilePreviewPluginProps) {
  const [loadState, setLoadState] = useState<TextFileLoadState>({ status: 'loading' })
  const sourceMetadata = metadataRequest ?? metadata.size

  // Layout cleanup invalidates reads before promise callbacks can beat passive cleanup.
  // Read metadata after ancestor layout setup, including Activity reconnections.
  useLayoutEffect(() => {
    let cancelled = false
    setLoadState((current) => (current.status === 'ready' ? current : { status: 'loading' }))

    void (async () => {
      try {
        const loadedMetadata =
          typeof sourceMetadata === 'function'
            ? await Promise.resolve().then(sourceMetadata)
            : { kind: 'file', size: sourceMetadata }
        if (cancelled || loadedMetadata?.kind !== 'file') return
        if (loadedMetadata.size === 0) {
          setLoadState({ status: 'empty' })
          return
        }

        if (loadedMetadata.size > FILE_EDIT_MAX_SIZE_BYTES) {
          setLoadState({ status: 'too_large' })
          return
        }

        const content = await window.api.fs.readText(filePath)
        if (!cancelled) setLoadState({ status: 'ready', content })
      } catch (error) {
        if (cancelled) return
        const normalized = error instanceof Error ? error : new Error(String(error))
        logger.error(`Failed to read text preview: ${filePath}`, normalized)
        setLoadState({ status: 'error', error: normalized })
      }
    })()

    return () => {
      cancelled = true
    }
  }, [filePath, sourceMetadata, refreshKey])

  return (
    <FilePreviewLayout.Frame>
      <FilePreviewLayout.Content composerInset={loadState.status !== 'ready'}>
        <TextPreviewContent filePath={filePath} loadState={loadState} onLineComment={onLineComment} />
      </FilePreviewLayout.Content>
    </FilePreviewLayout.Frame>
  )
}
