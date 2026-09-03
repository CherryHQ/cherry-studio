import { EmptyState } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { MarkdownHostProvider, StaticMarkdown } from '@renderer/components/markdown'
import { parseFileLinkHref } from '@renderer/utils/filePath'
import { normalizeFilePreviewPath } from '@renderer/utils/filePreview'
import { joinPath } from '@renderer/utils/path'
import { type AbsoluteFilePath, AbsoluteFilePathSchema } from '@shared/types/file'
import FileText from 'lucide-react/dist/esm/icons/file-text'
import FileWarning from 'lucide-react/dist/esm/icons/file-warning'
import LoaderCircle from 'lucide-react/dist/esm/icons/loader-circle'
import { lazy, type ReactNode, Suspense, useCallback, useEffect, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { FilePreviewLayout } from '../../FilePreviewLayout'
import type { FilePreviewPluginProps } from '../../types'
import { useOptionalFilePreviewNavigation } from '../../useFilePreviewNavigation'
import { type MarkdownFilePreviewMode, MarkdownFilePreviewToolbar } from './MarkdownFilePreviewToolbar'

const logger = loggerService.withContext('MarkdownFilePreview')
const MARKDOWN_PREVIEW_MAX_SIZE_MIB = 2
const MARKDOWN_PREVIEW_MAX_SIZE_BYTES = MARKDOWN_PREVIEW_MAX_SIZE_MIB * 1024 * 1024
const LazyCodeViewer = lazy(() => import('@renderer/components/CodeViewer'))

type MarkdownFileLoadState =
  | { status: 'error'; error: Error }
  | { status: 'loading' }
  | { status: 'ready'; content: string }
  | { status: 'too_large' }

function MarkdownPreviewLoading() {
  const { t } = useTranslation()

  return (
    <div role="status" className="flex h-full items-center justify-center gap-2 text-muted-foreground text-sm">
      <LoaderCircle className="size-4 animate-spin" aria-hidden />
      <span>{t('file_preview.loading')}</span>
    </div>
  )
}

function MarkdownPreviewError() {
  const { t } = useTranslation()

  return (
    <div role="alert" className="h-full">
      <EmptyState
        icon={FileWarning}
        title={t('file_preview.markdown.read_error.title')}
        description={t('file_preview.load_error.description')}
        className="h-full"
      />
    </div>
  )
}

function MarkdownPreviewTooLarge() {
  const { t } = useTranslation()

  return (
    <div role="alert" className="h-full">
      <EmptyState
        icon={FileWarning}
        title={t('file_preview.markdown.too_large.title')}
        description={t('file_preview.markdown.too_large.description', { limit: MARKDOWN_PREVIEW_MAX_SIZE_MIB })}
        className="h-full"
      />
    </div>
  )
}

function MarkdownPreviewEmpty() {
  const { t } = useTranslation()

  return (
    <EmptyState
      icon={FileText}
      title={t('file_preview.markdown.empty.title')}
      description={t('file_preview.markdown.empty.description')}
      className="h-full"
    />
  )
}

interface MarkdownPreviewContentProps {
  loadState: MarkdownFileLoadState
  markdownId: string
  mode: MarkdownFilePreviewMode
}

function resolveMarkdownFileLink(workspacePath: AbsoluteFilePath, href: string | undefined): AbsoluteFilePath | null {
  const linkPath = parseFileLinkHref(href)
  if (!linkPath) return null

  const candidate = AbsoluteFilePathSchema.safeParse(linkPath).success ? linkPath : joinPath(workspacePath, linkPath)

  try {
    return normalizeFilePreviewPath(candidate)
  } catch {
    return null
  }
}

function MarkdownPreviewContent({ loadState, markdownId, mode }: MarkdownPreviewContentProps): ReactNode {
  const navigation = useOptionalFilePreviewNavigation()
  const openFilePath = useCallback(
    (path: string) => {
      if (!navigation) return
      const target = resolveMarkdownFileLink(navigation.workspacePath, path)
      if (target) return navigation.openFile(target)
    },
    [navigation]
  )

  if (loadState.status === 'loading') return <MarkdownPreviewLoading />
  if (loadState.status === 'error') return <MarkdownPreviewError />
  if (loadState.status === 'too_large') return <MarkdownPreviewTooLarge />

  if (mode === 'source') {
    return (
      <div className="flex min-h-full w-full">
        <Suspense fallback={<MarkdownPreviewLoading />}>
          <LazyCodeViewer
            value={loadState.content}
            language="markdown"
            wrapped
            className="min-w-0 flex-1 overflow-hidden"
          />
        </Suspense>
      </div>
    )
  }

  if (loadState.content.trim().length === 0) return <MarkdownPreviewEmpty />

  const markdown = (
    <div className="mx-auto w-full max-w-4xl px-4">
      <StaticMarkdown id={markdownId}>{loadState.content}</StaticMarkdown>
    </div>
  )

  return navigation ? <MarkdownHostProvider openFilePath={openFilePath}>{markdown}</MarkdownHostProvider> : markdown
}

export default function MarkdownFilePreview({ filePath, metadata, refreshKey, type = 'file' }: FilePreviewPluginProps) {
  const markdownId = useId()
  const [mode, setMode] = useState<MarkdownFilePreviewMode>('preview')
  const [loadState, setLoadState] = useState<MarkdownFileLoadState>({ status: 'loading' })
  const effectiveMode = type === 'artifact' ? 'preview' : mode

  useEffect(() => {
    let cancelled = false
    setLoadState({ status: 'loading' })

    void (async () => {
      try {
        if (metadata.size > MARKDOWN_PREVIEW_MAX_SIZE_BYTES) {
          setLoadState({ status: 'too_large' })
          return
        }

        const content = await window.api.fs.readText(filePath)
        if (!cancelled) setLoadState({ status: 'ready', content })
      } catch (error) {
        if (cancelled) return
        const normalized = error instanceof Error ? error : new Error(String(error))
        logger.error(`Failed to read Markdown preview: ${filePath}`, normalized)
        setLoadState({ status: 'error', error: normalized })
      }
    })()

    return () => {
      cancelled = true
    }
  }, [filePath, metadata.size, refreshKey])

  return (
    <FilePreviewLayout.Frame>
      {type === 'file' ? (
        <MarkdownFilePreviewToolbar disabled={loadState.status !== 'ready'} mode={mode} onModeChange={setMode} />
      ) : null}
      <FilePreviewLayout.Content>
        <MarkdownPreviewContent loadState={loadState} markdownId={markdownId} mode={effectiveMode} />
      </FilePreviewLayout.Content>
    </FilePreviewLayout.Frame>
  )
}
