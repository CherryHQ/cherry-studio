import { EmptyState } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import CodeViewer from '@renderer/components/CodeViewer'
import { getLanguageByFilePath } from '@renderer/utils/codeLanguage'
import { createFilePathHandle } from '@shared/utils/file'
import FileText from 'lucide-react/dist/esm/icons/file-text'
import FileWarning from 'lucide-react/dist/esm/icons/file-warning'
import LoaderCircle from 'lucide-react/dist/esm/icons/loader-circle'
import { type ReactNode, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { FilePreviewLayout } from '../../FilePreviewLayout'
import type { FilePreviewPluginProps } from '../../types'

const logger = loggerService.withContext('TextFilePreview')
const TEXT_PREVIEW_MAX_SIZE_MIB = 2
const TEXT_PREVIEW_MAX_SIZE_BYTES = TEXT_PREVIEW_MAX_SIZE_MIB * 1024 * 1024

type TextFileLoadState =
  | { status: 'empty' }
  | { status: 'error'; error: Error }
  | { status: 'loading' }
  | { status: 'ready'; content: string }
  | { status: 'too_large' }

function TextPreviewLoading() {
  const { t } = useTranslation()

  return (
    <div role="status" className="flex h-full items-center justify-center gap-2 text-muted-foreground text-sm">
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

function TextPreviewError({ error }: { error: Error }) {
  const { t } = useTranslation()

  return (
    <div role="alert" className="h-full">
      <EmptyState
        icon={FileWarning}
        title={t('file_preview.text.read_error.title')}
        description={error.message}
        className="h-full [&_p]:break-all"
      />
    </div>
  )
}

interface TextPreviewContentProps {
  filePath: string
  loadState: TextFileLoadState
}

function TextPreviewContent({ filePath, loadState }: TextPreviewContentProps): ReactNode {
  if (loadState.status === 'loading') return <TextPreviewLoading />
  if (loadState.status === 'empty') return <TextPreviewEmpty />
  if (loadState.status === 'too_large') return <TextPreviewTooLarge />
  if (loadState.status === 'error') return <TextPreviewError error={loadState.error} />

  return (
    <div className="min-h-full w-full">
      <CodeViewer
        value={loadState.content}
        language={getLanguageByFilePath(filePath)}
        wrapped={false}
        className="min-h-full w-full"
      />
    </div>
  )
}

export default function TextFilePreview({ filePath, refreshKey }: FilePreviewPluginProps) {
  const [loadState, setLoadState] = useState<TextFileLoadState>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    setLoadState({ status: 'loading' })

    void (async () => {
      try {
        const metadata = await window.api.file.getMetadata(createFilePathHandle(filePath))
        if (cancelled) return

        if (metadata.size === 0) {
          setLoadState({ status: 'empty' })
          return
        }

        if (metadata.size > TEXT_PREVIEW_MAX_SIZE_BYTES) {
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
  }, [filePath, refreshKey])

  return (
    <FilePreviewLayout.Frame>
      <FilePreviewLayout.Content>
        <TextPreviewContent filePath={filePath} loadState={loadState} />
      </FilePreviewLayout.Content>
    </FilePreviewLayout.Frame>
  )
}
