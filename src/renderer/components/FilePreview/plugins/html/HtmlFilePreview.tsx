import { EmptyState } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import HtmlPreviewFrame, {
  HTML_PREVIEW_RESTRICTED_CSP,
  HTML_PREVIEW_RESTRICTED_SANDBOX
} from '@renderer/components/CodeBlockView/HtmlPreviewFrame'
import { getFilePreviewExtension } from '@renderer/utils/filePreview'
import { createFilePathHandle, toSafeFileUrl } from '@shared/utils/file'
import FileCode from 'lucide-react/dist/esm/icons/file-code'
import FileWarning from 'lucide-react/dist/esm/icons/file-warning'
import LoaderCircle from 'lucide-react/dist/esm/icons/loader-circle'
import { lazy, type ReactNode, Suspense, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { FilePreviewLayout } from '../../FilePreviewLayout'
import type { FilePreviewPluginProps } from '../../types'
import { type HtmlFilePreviewMode, HtmlFilePreviewToolbar } from './HtmlFilePreviewToolbar'

const logger = loggerService.withContext('HtmlFilePreview')
const HTML_PREVIEW_MAX_SIZE_MIB = 2
const HTML_PREVIEW_MAX_SIZE_BYTES = HTML_PREVIEW_MAX_SIZE_MIB * 1024 * 1024
const LazyCodeViewer = lazy(() => import('@renderer/components/CodeViewer'))

type HtmlFileLoadState =
  | { status: 'error'; error: Error }
  | { status: 'loading' }
  | { status: 'ready'; content: string }
  | { status: 'too_large' }

function HtmlPreviewLoading() {
  const { t } = useTranslation()

  return (
    <div role="status" className="flex h-full items-center justify-center gap-2 text-muted-foreground text-sm">
      <LoaderCircle className="size-4 animate-spin" aria-hidden />
      <span>{t('file_preview.loading')}</span>
    </div>
  )
}

function HtmlPreviewError({ error }: { error: Error }) {
  const { t } = useTranslation()

  return (
    <div role="alert" className="h-full">
      <EmptyState
        icon={FileWarning}
        title={t('file_preview.html.read_error.title')}
        description={error.message}
        className="h-full [&_p]:break-all"
      />
    </div>
  )
}

function HtmlPreviewTooLarge() {
  const { t } = useTranslation()

  return (
    <div role="alert" className="h-full">
      <EmptyState
        icon={FileWarning}
        title={t('file_preview.html.too_large.title')}
        description={t('file_preview.html.too_large.description', { limit: HTML_PREVIEW_MAX_SIZE_MIB })}
        className="h-full"
      />
    </div>
  )
}

function HtmlPreviewEmpty() {
  const { t } = useTranslation()

  return (
    <EmptyState
      icon={FileCode}
      title={t('file_preview.html.empty.title')}
      description={t('file_preview.html.empty.description')}
      className="h-full"
    />
  )
}

interface HtmlPreviewContentProps {
  loadState: HtmlFileLoadState
  fileName: string
  baseUrl: string
  mode: HtmlFilePreviewMode
}

function HtmlPreviewContent({ loadState, fileName, baseUrl, mode }: HtmlPreviewContentProps): ReactNode {
  if (loadState.status === 'loading') return <HtmlPreviewLoading />
  if (loadState.status === 'error') return <HtmlPreviewError error={loadState.error} />
  if (loadState.status === 'too_large') return <HtmlPreviewTooLarge />

  if (mode === 'source') {
    return (
      <div className="flex min-h-full w-full">
        <Suspense fallback={<HtmlPreviewLoading />}>
          <LazyCodeViewer
            value={loadState.content}
            language="html"
            wrapped
            className="min-w-0 flex-1 overflow-hidden"
          />
        </Suspense>
      </div>
    )
  }

  if (loadState.content.trim().length === 0) return <HtmlPreviewEmpty />

  // Local files are untrusted: use the fully-restricted, script-less sandbox plus a strict
  // CSP. Because the main window runs with `webSecurity: false`, dropping `allow-same-origin`
  // alone is not a boundary — only running no scripts reliably keeps a malicious file from
  // reaching `parent.api` to read/exfiltrate other local files.
  return (
    <HtmlPreviewFrame
      html={loadState.content}
      title={fileName}
      baseUrl={baseUrl}
      sandbox={HTML_PREVIEW_RESTRICTED_SANDBOX}
      csp={HTML_PREVIEW_RESTRICTED_CSP}
    />
  )
}

export default function HtmlFilePreview({ filePath, fileName, refreshKey }: FilePreviewPluginProps) {
  const [mode, setMode] = useState<HtmlFilePreviewMode>('preview')
  const [loadState, setLoadState] = useState<HtmlFileLoadState>({ status: 'loading' })
  const baseUrl = useMemo(() => toSafeFileUrl(filePath, getFilePreviewExtension(filePath)), [filePath])

  useEffect(() => {
    let cancelled = false
    setLoadState({ status: 'loading' })

    void (async () => {
      try {
        const metadata = await window.api.file.getMetadata(createFilePathHandle(filePath))
        if (cancelled) return

        if (metadata.size > HTML_PREVIEW_MAX_SIZE_BYTES) {
          setLoadState({ status: 'too_large' })
          return
        }

        const content = await window.api.fs.readText(filePath)
        if (!cancelled) setLoadState({ status: 'ready', content })
      } catch (error) {
        if (cancelled) return
        const normalized = error instanceof Error ? error : new Error(String(error))
        logger.error(`Failed to read HTML preview: ${filePath}`, normalized)
        setLoadState({ status: 'error', error: normalized })
      }
    })()

    return () => {
      cancelled = true
    }
  }, [filePath, refreshKey])

  return (
    <FilePreviewLayout.Frame>
      <HtmlFilePreviewToolbar disabled={loadState.status !== 'ready'} mode={mode} onModeChange={setMode} />
      <FilePreviewLayout.Content>
        <HtmlPreviewContent loadState={loadState} fileName={fileName} baseUrl={baseUrl} mode={mode} />
      </FilePreviewLayout.Content>
    </FilePreviewLayout.Frame>
  )
}
