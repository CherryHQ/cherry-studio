import FileText from 'lucide-react/dist/esm/icons/file-text'
import FileWarning from 'lucide-react/dist/esm/icons/file-warning'
import LoaderCircle from 'lucide-react/dist/esm/icons/loader-circle'
import { lazy, type ReactNode, Suspense, useCallback, useEffect, useId, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { EmptyState } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { MarkdownHostProvider } from '@renderer/components/markdown'
import { parseFileLinkHref } from '@renderer/utils/filePath'
import { normalizeFilePreviewPath } from '@renderer/utils/filePreview'
import { joinPath } from '@renderer/utils/path'
import { type AbsoluteFilePath, AbsoluteFilePathSchema } from '@shared/types/file'

import { FilePreviewLayout } from '../../FilePreviewLayout'
import { hasPathologicalLongLines } from '../../textPreviewGuard'
import type { FilePreviewPluginProps } from '../../types'
import { useOptionalFilePreviewNavigation } from '../../useFilePreviewNavigation'
import { MarkdownChunkPreview } from './MarkdownChunkPreview'
import { hasOversizedMarkdownBlock } from './markdownChunks'
import { type MarkdownFilePreviewMode, MarkdownFilePreviewToolbar } from './MarkdownFilePreviewToolbar'

const logger = loggerService.withContext('MarkdownFilePreview')
const MARKDOWN_PREVIEW_MAX_SIZE_MIB = 2
const MARKDOWN_PREVIEW_MAX_SIZE_BYTES = MARKDOWN_PREVIEW_MAX_SIZE_MIB * 1024 * 1024
const YAML_FRONTMATTER_PATTERN = /^(?:\uFEFF)?---[^\S\r\n]*\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)[^\S\r\n]*(?:\r?\n|$)/
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

function MarkdownPreviewPlainFallback() {
  const { t } = useTranslation()

  return (
    <div role="note" className="border-border border-b px-4 py-2 text-muted-foreground text-xs">
      {t('file_preview.markdown.plain_fallback.description')}
    </div>
  )
}

interface MarkdownPreviewContentProps {
  loadState: MarkdownFileLoadState
  markdownId: string
  mode: MarkdownFilePreviewMode
  richPreview: boolean
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

function MarkdownPreviewContent({ loadState, markdownId, mode, richPreview }: MarkdownPreviewContentProps): ReactNode {
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
    // The viewer owns the scroll here: its virtualizer measures its own scroller, so an unbounded
    // wrapper would hand it the whole document as the viewport and materialize every row.
    return (
      <div className="flex h-full min-h-0 w-full">
        <Suspense fallback={<MarkdownPreviewLoading />}>
          <LazyCodeViewer
            value={loadState.content}
            language="markdown"
            wrapped
            expanded={false}
            height="100%"
            options={{ highlight: richPreview }}
            className="min-w-0 flex-1 overflow-hidden pb-[var(--chat-composer-inset,0px)]"
          />
        </Suspense>
      </div>
    )
  }

  if (loadState.content.trim().length === 0) return <MarkdownPreviewEmpty />

  const markdown = <MarkdownChunkPreview content={loadState.content} id={markdownId} />

  return navigation ? <MarkdownHostProvider openFilePath={openFilePath}>{markdown}</MarkdownHostProvider> : markdown
}

export default function MarkdownFilePreview({ filePath, metadata, refreshKey, type = 'file' }: FilePreviewPluginProps) {
  const markdownId = useId()
  const [mode, setMode] = useState<MarkdownFilePreviewMode>('preview')
  const [loadState, setLoadState] = useState<MarkdownFileLoadState>({ status: 'loading' })
  const readyContent = loadState.status === 'ready' ? loadState.content : null
  // Windowing keeps large documents responsive, so only input it cannot window falls back: very
  // long lines, or a single block large enough that it would still reach the renderer whole.
  const plainFallback = useMemo(
    () => readyContent !== null && (hasPathologicalLongLines(readyContent) || hasOversizedMarkdownBlock(readyContent)),
    [readyContent]
  )
  const effectiveMode = plainFallback ? 'source' : type === 'artifact' ? 'preview' : mode
  const viewerOwnsScroll =
    loadState.status === 'ready' && (effectiveMode === 'source' || (readyContent ?? '').trim().length > 0)

  useEffect(() => {
    let cancelled = false
    setLoadState({ status: 'loading' })

    void (async () => {
      try {
        if (metadata.size > MARKDOWN_PREVIEW_MAX_SIZE_BYTES) {
          setLoadState({ status: 'too_large' })
          return
        }

        const text = await window.api.fs.readText(filePath)
        if (cancelled) return
        // Stripping happens at read time so every later decision — fallback, mode, scroll owner —
        // sees exactly what the rendered view is allowed to show.
        setLoadState({
          status: 'ready',
          content: type === 'artifact' ? text.replace(YAML_FRONTMATTER_PATTERN, '') : text
        })
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
  }, [filePath, metadata.size, refreshKey, type])

  return (
    <FilePreviewLayout.Frame>
      {type === 'file' ? (
        <MarkdownFilePreviewToolbar
          disabled={loadState.status !== 'ready' || plainFallback}
          mode={effectiveMode}
          onModeChange={setMode}
        />
      ) : null}
      {plainFallback ? <MarkdownPreviewPlainFallback /> : null}
      {/* Both render modes hand scrolling to their own bounded viewer, which paints an opaque
          surface and pads the composer inset inside itself. */}
      <FilePreviewLayout.Content composerInset={!viewerOwnsScroll}>
        <MarkdownPreviewContent
          loadState={loadState}
          markdownId={markdownId}
          mode={effectiveMode}
          richPreview={!plainFallback}
        />
      </FilePreviewLayout.Content>
    </FilePreviewLayout.Frame>
  )
}
