import Copy from 'lucide-react/dist/esm/icons/copy'
import FileDown from 'lucide-react/dist/esm/icons/file-down'
import FileText from 'lucide-react/dist/esm/icons/file-text'
import FileWarning from 'lucide-react/dist/esm/icons/file-warning'
import ImageDown from 'lucide-react/dist/esm/icons/image-down'
import LoaderCircle from 'lucide-react/dist/esm/icons/loader-circle'
import RefreshCcw from 'lucide-react/dist/esm/icons/refresh-ccw'
import ZoomIn from 'lucide-react/dist/esm/icons/zoom-in'
import ZoomOut from 'lucide-react/dist/esm/icons/zoom-out'
import { useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { FilePreviewLayout, FilePreviewToolbar, FilePreviewToolbarButton } from '@cherrystudio/file-preview/react'
import { EmptyState } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import MermaidPreview from '@renderer/components/Preview/MermaidPreview'
import type { BasicPreviewHandles } from '@renderer/components/Preview/types'

import type { FilePreviewPluginProps } from '../../types'

const logger = loggerService.withContext('MermaidFilePreview')

type LoadState = { status: 'loading' } | { status: 'error' } | { status: 'ready'; source: string }

const ZOOM_STEP = 0.1

/** Renders a `.mmd` / `.mermaid` file as its diagram, edge to edge on the pane's own background. */
export default function MermaidFilePreview({ filePath, refreshKey }: FilePreviewPluginProps) {
  const { t } = useTranslation()
  const [loadState, setLoadState] = useState<LoadState>({ status: 'loading' })
  const previewRef = useRef<BasicPreviewHandles | null>(null)

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
      <MermaidPreview ref={previewRef} fit="contain" className="h-full w-full">
        {loadState.source}
      </MermaidPreview>
    )
  }

  const ready = loadState.status === 'ready' && Boolean(loadState.source.trim())
  const actions: Array<{ label: string; icon: typeof ZoomIn; run: (preview: BasicPreviewHandles) => unknown }> = [
    { label: t('preview.zoom_out'), icon: ZoomOut, run: (preview) => preview.zoom(-ZOOM_STEP) },
    { label: t('preview.zoom_in'), icon: ZoomIn, run: (preview) => preview.zoom(ZOOM_STEP) },
    {
      label: t('preview.reset'),
      icon: RefreshCcw,
      run: (preview) => {
        preview.pan(0, 0, true)
        preview.zoom(1, true)
      }
    },
    { label: t('preview.copy.image'), icon: Copy, run: (preview) => preview.copy() },
    { label: t('code_block.download.svg'), icon: FileDown, run: (preview) => preview.download('svg') },
    { label: t('code_block.download.png'), icon: ImageDown, run: (preview) => preview.download('png') }
  ]

  return (
    <FilePreviewLayout.Frame>
      {/* Format controls join the host's header row through the file-preview toolbar portal, like image previews. */}
      <FilePreviewToolbar aria-label={t('preview.label')}>
        {actions.map(({ label, icon: Icon, run }) => (
          <FilePreviewToolbarButton
            key={label}
            label={label}
            disabled={!ready}
            onClick={() => previewRef.current && void run(previewRef.current)}>
            <Icon aria-hidden />
          </FilePreviewToolbarButton>
        ))}
      </FilePreviewToolbar>
      <FilePreviewLayout.Content composerInset={loadState.status !== 'ready'}>{content}</FilePreviewLayout.Content>
    </FilePreviewLayout.Frame>
  )
}
