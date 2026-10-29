import FileText from 'lucide-react/dist/esm/icons/file-text'
import FileWarning from 'lucide-react/dist/esm/icons/file-warning'
import LoaderCircle from 'lucide-react/dist/esm/icons/loader-circle'
import { useLayoutEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { FilePreviewLayout } from '@cherrystudio/file-preview/react'
import { EmptyState } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import MermaidPreview from '@renderer/components/Preview/MermaidPreview'

import type { FilePreviewPluginProps } from '../../types'

const logger = loggerService.withContext('MermaidFilePreview')

type LoadState = { status: 'loading' } | { status: 'error' } | { status: 'ready'; source: string }

/** Renders a `.mmd` / `.mermaid` file as its diagram, edge to edge on the pane's own background. */
export default function MermaidFilePreview({ filePath, refreshKey }: FilePreviewPluginProps) {
  const { t } = useTranslation()
  const [loadState, setLoadState] = useState<LoadState>({ status: 'loading' })

  // Layout cleanup invalidates the read before its promise can resolve into a stale file.
  useLayoutEffect(() => {
    let cancelled = false
    window.api.fs.readText(filePath).then(
      (source) => !cancelled && setLoadState({ status: 'ready', source }),
      (error: unknown) => {
        if (cancelled) return
        logger.error(`Failed to read Mermaid file: ${filePath}`, error as Error)
        setLoadState({ status: 'error' })
      }
    )
    return () => {
      cancelled = true
    }
  }, [filePath, refreshKey])

  let content
  if (loadState.status === 'loading') {
    content = (
      <div role="status" className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
        <LoaderCircle className="size-4 animate-spin" aria-hidden />
        <span>{t('file_preview.loading')}</span>
      </div>
    )
  } else if (loadState.status === 'error') {
    content = (
      <EmptyState
        icon={FileWarning}
        title={t('file_preview.load_error.title')}
        description={t('file_preview.load_error.description')}
        className="h-full"
      />
    )
  } else if (!loadState.source.trim()) {
    content = (
      <EmptyState
        icon={FileText}
        title={t('file_preview.text.empty.title')}
        description={t('file_preview.text.empty.description')}
        className="h-full"
      />
    )
  } else {
    content = (
      <MermaidPreview enableToolbar fit="contain" className="h-full w-full">
        {loadState.source}
      </MermaidPreview>
    )
  }

  return (
    <FilePreviewLayout.Frame>
      <FilePreviewLayout.Content composerInset={loadState.status !== 'ready'}>{content}</FilePreviewLayout.Content>
    </FilePreviewLayout.Frame>
  )
}
