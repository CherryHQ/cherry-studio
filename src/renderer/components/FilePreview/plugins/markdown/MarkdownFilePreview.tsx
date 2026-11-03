import FileText from 'lucide-react/dist/esm/icons/file-text'
import FileWarning from 'lucide-react/dist/esm/icons/file-warning'
import LoaderCircle from 'lucide-react/dist/esm/icons/loader-circle'
import { lazy, type ReactNode, Suspense, useCallback, useId, useLayoutEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { FilePreviewLayout } from '@cherrystudio/file-preview/react'
import { EmptyState } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { MarkdownHostProvider, StaticMarkdown } from '@renderer/components/markdown'
import { parseFileLinkHref } from '@renderer/utils/filePath'
import { normalizeFilePreviewPath } from '@renderer/utils/filePreview'
import { joinPath } from '@renderer/utils/path'
import { type AbsoluteFilePath, AbsoluteFilePathSchema } from '@shared/types/file'
import { toFileUrl } from '@shared/utils/file'

import type { FilePreviewPluginProps } from '../../types'
import { useOptionalFilePreviewNavigation } from '../../useFilePreviewNavigation'
import { type MarkdownFilePreviewMode, MarkdownFilePreviewToolbar } from './MarkdownFilePreviewToolbar'

const logger = loggerService.withContext('MarkdownFilePreview')
const YAML_FRONTMATTER_PATTERN = /^(?:\uFEFF)?---[^\S\r\n]*\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)[^\S\r\n]*(?:\r?\n|$)/
const FileEditor = lazy(() => import('@renderer/components/FileEditor'))

type MarkdownFileLoadState =
  | { status: 'error'; error: Error }
  | { status: 'loading' }
  | { status: 'ready'; content: string; renderVersion: number }

function MarkdownPreviewLoading() {
  const { t } = useTranslation()

  return (
    <div role="status" className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
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
  filePath: AbsoluteFilePath
  hideFrontmatter: boolean
  loadState: MarkdownFileLoadState
  markdownId: string
  mode: MarkdownFilePreviewMode
}

function resolveMarkdownImageSrc(filePath: AbsoluteFilePath, src: string): string | null {
  if (!src || src.trim() !== src || /^[/?#]|^[a-z][a-z0-9+.-]*:|[\\\p{Cc}]|%2f|%5c/iu.test(src)) return src

  try {
    return new URL(src, toFileUrl(filePath)).href
  } catch {
    return null
  }
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

function MarkdownPreviewContent({
  filePath,
  hideFrontmatter,
  loadState,
  markdownId,
  mode
}: MarkdownPreviewContentProps): ReactNode {
  const navigation = useOptionalFilePreviewNavigation()
  const resolveImageSrc = useCallback((src: string) => resolveMarkdownImageSrc(filePath, src), [filePath])
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

  if (mode === 'source') {
    return (
      <div className="flex min-h-full w-full">
        <Suspense fallback={<MarkdownPreviewLoading />}>
          <FileEditor
            value={loadState.content}
            fileName={filePath}
            wrapLines
            readOnly
            expanded
            className="min-w-0 flex-1"
          />
        </Suspense>
      </div>
    )
  }

  const content = hideFrontmatter ? loadState.content.replace(YAML_FRONTMATTER_PATTERN, '') : loadState.content
  if (content.trim().length === 0) return <MarkdownPreviewEmpty />

  const markdown = (
    <div className="mx-auto w-full max-w-4xl px-4 pt-4">
      <StaticMarkdown id={`${markdownId}:${loadState.renderVersion}`}>{content}</StaticMarkdown>
    </div>
  )

  return (
    <MarkdownHostProvider resolveImageSrc={resolveImageSrc} openFilePath={navigation ? openFilePath : undefined}>
      {markdown}
    </MarkdownHostProvider>
  )
}

export default function MarkdownFilePreview({
  filePath,
  metadata,
  metadataRequest,
  refreshKey,
  type = 'file'
}: FilePreviewPluginProps) {
  const markdownId = useId()
  const [mode, setMode] = useState<MarkdownFilePreviewMode>('preview')
  const [loadState, setLoadState] = useState<MarkdownFileLoadState>({ status: 'loading' })
  const sourceMetadata = metadataRequest ?? metadata.size
  const effectiveMode = type === 'artifact' ? 'preview' : mode

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

        const content = await window.api.fs.readText(filePath)
        if (!cancelled) {
          // A completed read resets document-derived renderer state, including failed images.
          setLoadState((current) => ({
            status: 'ready',
            content,
            renderVersion: current.status === 'ready' ? current.renderVersion + 1 : 0
          }))
        }
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
  }, [filePath, sourceMetadata, refreshKey])

  return (
    <FilePreviewLayout.Frame>
      {type === 'file' ? (
        <MarkdownFilePreviewToolbar disabled={loadState.status !== 'ready'} mode={mode} onModeChange={setMode} />
      ) : null}
      <FilePreviewLayout.Content>
        <MarkdownPreviewContent
          filePath={filePath}
          hideFrontmatter={type === 'artifact'}
          loadState={loadState}
          markdownId={markdownId}
          mode={effectiveMode}
        />
      </FilePreviewLayout.Content>
    </FilePreviewLayout.Frame>
  )
}
