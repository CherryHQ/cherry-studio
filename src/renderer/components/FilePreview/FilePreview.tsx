import { EmptyState } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { toast } from '@renderer/services/toast'
import { safeOpen } from '@renderer/utils/file/safeOpen'
import { getFilePreviewFileName, normalizeFilePreviewPath } from '@renderer/utils/filePreview'
import type { FilePath } from '@shared/types/file'
import { createFilePathHandle } from '@shared/utils/file'
import { FileQuestion, FileWarning, FileX2, LoaderCircle } from 'lucide-react'
import { lazy, type ReactNode, Suspense, useMemo } from 'react'
import { ErrorBoundary } from 'react-error-boundary'
import { useTranslation } from 'react-i18next'

import { FilePreviewLayout } from './FilePreviewLayout'
import { filePreviewRegistry, resolveExtensionPlugin } from './filePreviewRegistry'
import { FilePreviewToolbarPortalHost, FilePreviewToolbarPortalProvider } from './FilePreviewToolbar'
import type { FilePreviewPlugin } from './types'

const logger = loggerService.withContext('FilePreview')

type FilePreviewStateKind = 'invalid_path' | 'load_error' | 'unsupported'

const FILE_PREVIEW_STATE_KEYS = {
  invalid_path: {
    description: 'file_preview.invalid_path.description',
    title: 'file_preview.invalid_path.title'
  },
  load_error: {
    description: 'file_preview.load_error.description',
    title: 'file_preview.load_error.title'
  },
  unsupported: {
    description: 'file_preview.unsupported.description',
    title: 'file_preview.unsupported.title'
  }
} as const satisfies Record<FilePreviewStateKind, { description: string; title: string }>

interface FilePreviewStateProps {
  kind: FilePreviewStateKind
  filePath?: FilePath
}

function FilePreviewState({ kind, filePath }: FilePreviewStateProps) {
  const { t } = useTranslation()
  const Icon = kind === 'unsupported' ? FileQuestion : kind === 'invalid_path' ? FileX2 : FileWarning
  const keys = FILE_PREVIEW_STATE_KEYS[kind]
  // Only the "unsupported" state can fall back to an external open: the path is
  // already validated (unlike invalid_path) and points at a real file we simply
  // cannot render inline. `safeOpen` enforces the unsafe-extension policy.
  const openablePath = kind === 'unsupported' ? filePath : undefined
  const handleOpenWithDefaultApp = () => {
    if (!openablePath) return
    void safeOpen(createFilePathHandle(openablePath)).catch(() => toast.error(t('file_preview.unsupported.open_error')))
  }

  return (
    <FilePreviewLayout.Frame>
      <FilePreviewLayout.Content>
        <EmptyState
          icon={Icon}
          title={t(keys.title)}
          description={t(keys.description)}
          className="h-full"
          actionLabel={openablePath ? t('file_preview.unsupported.action') : undefined}
          onAction={openablePath ? handleOpenWithDefaultApp : undefined}
        />
      </FilePreviewLayout.Content>
    </FilePreviewLayout.Frame>
  )
}

function FilePreviewLoading() {
  const { t } = useTranslation()

  return (
    <FilePreviewLayout.Frame>
      <FilePreviewLayout.Content>
        <div className="flex h-full items-center justify-center gap-2 text-muted-foreground text-sm">
          <LoaderCircle className="size-4 animate-spin" aria-hidden />
          <span>{t('file_preview.loading')}</span>
        </div>
      </FilePreviewLayout.Content>
    </FilePreviewLayout.Frame>
  )
}

function PluginErrorFallback() {
  return <FilePreviewState kind="load_error" />
}

interface FilePreviewPluginRendererProps {
  fileName: string
  filePath: FilePath
  plugin: FilePreviewPlugin
  refreshKey: number
}

interface FilePreviewShellProps {
  children: ReactNode
  header?: ReactNode
}

function FilePreviewShell({ children, header }: FilePreviewShellProps) {
  if (header === undefined) return children

  return (
    <FilePreviewToolbarPortalProvider>
      <FilePreviewLayout.Frame>
        <div
          data-testid="file-preview-header"
          className="flex h-10 min-h-10 shrink-0 items-center border-border-muted border-b px-3">
          <div className="flex min-w-0 flex-1 items-center gap-2">{header}</div>
          <FilePreviewToolbarPortalHost />
        </div>
        <div className="min-h-0 flex-1 overflow-hidden px-3">{children}</div>
      </FilePreviewLayout.Frame>
    </FilePreviewToolbarPortalProvider>
  )
}

function FilePreviewPluginRenderer({ fileName, filePath, plugin, refreshKey }: FilePreviewPluginRendererProps) {
  const PluginPreview = useMemo(() => lazy(plugin.load), [plugin])

  return (
    <ErrorBoundary
      key={`${plugin.id}:${filePath}:${refreshKey}`}
      FallbackComponent={PluginErrorFallback}
      onError={(error) => logger.error(`Failed to render file preview plugin: ${plugin.id}`, error)}>
      <Suspense fallback={<FilePreviewLoading />}>
        <PluginPreview filePath={filePath} fileName={fileName} refreshKey={refreshKey} />
      </Suspense>
    </ErrorBoundary>
  )
}

export interface FilePreviewProps {
  filePath: FilePath
  header?: ReactNode
  refreshKey?: number
}

export function FilePreview({ filePath, header, refreshKey = 0 }: FilePreviewProps) {
  const file = useMemo(() => {
    try {
      const normalizedPath = normalizeFilePreviewPath(filePath)
      return { fileName: getFilePreviewFileName(normalizedPath), filePath: normalizedPath }
    } catch {
      return null
    }
  }, [filePath])

  let preview: ReactNode

  if (!file) {
    preview = <FilePreviewState kind="invalid_path" />
  } else {
    const extensionPlugin = resolveExtensionPlugin(file.filePath, filePreviewRegistry)
    preview = extensionPlugin ? (
      <FilePreviewPluginRenderer {...file} plugin={extensionPlugin} refreshKey={refreshKey} />
    ) : (
      <FilePreviewState kind="unsupported" filePath={file.filePath} />
    )
  }

  return <FilePreviewShell header={header}>{preview}</FilePreviewShell>
}
