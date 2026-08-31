/* eslint-disable simple-import-sort/imports */
import { EmptyState } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { ipcApi } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'
import { safeOpen } from '@renderer/utils/file/safeOpen'
import { getFilePreviewFileName, normalizeFilePreviewPath } from '@renderer/utils/filePreview'
import type { AbsoluteFilePath } from '@shared/types/file'
import { createFilePathHandle } from '@shared/utils/file'
import { FileQuestion, FileWarning, FileX2, FolderOpen, LoaderCircle } from 'lucide-react'
import { createElement, Suspense, type ComponentType, type ReactNode, useEffect, useMemo, useState } from 'react'
import { ErrorBoundary } from 'react-error-boundary'
import { useTranslation } from 'react-i18next'

import { FilePreviewLayout } from './FilePreviewLayout'
import { FilePreviewToolbarPortalHost, FilePreviewToolbarPortalProvider } from './FilePreviewToolbar'
import { filePreviewRegistry, resolveExtensionPlugin } from './filePreviewRegistry'
import { textFilePreviewPlugin } from './plugins/text/textFilePreviewPlugin'
import type { FilePreviewFileMetadata, FilePreviewPlugin, FilePreviewPluginProps, FilePreviewType } from './types'

const logger = loggerService.withContext('FilePreview')
const TEXT_CONTENT_PLUGIN_IDS = new Set(['html', 'markdown', 'text'])

// Cache for pre-loaded plugin modules. Each plugin's load() is called at most once.
// The WeakMap key is the plugin object (stable identity from the registry).
// The cache lives behind a mutable binding so test code can clear it between cases
// via `__filePreviewInternal.resetLoadedModules()`. Production code never calls reset.
let loadedModules: WeakMap<
  FilePreviewPlugin,
  Promise<{ default: ComponentType<FilePreviewPluginProps> }>
> = new WeakMap()

export const __filePreviewInternal = {
  resetLoadedModules(): void {
    loadedModules = new WeakMap()
  }
}

type FilePreviewStateKind = 'directory' | 'invalid_path' | 'load_error' | 'unavailable' | 'unsupported'

const FILE_PREVIEW_STATE_KEYS = {
  directory: {
    description: 'file_preview.directory.description',
    title: 'file_preview.directory.title'
  },
  invalid_path: {
    description: 'file_preview.invalid_path.description',
    title: 'file_preview.invalid_path.title'
  },
  load_error: {
    description: 'file_preview.load_error.description',
    title: 'file_preview.load_error.title'
  },
  unavailable: {
    description: 'file_preview.unavailable.description',
    title: 'file_preview.unavailable.title'
  },
  unsupported: {
    description: 'file_preview.unsupported.description',
    title: 'file_preview.unsupported.title'
  }
} as const satisfies Record<FilePreviewStateKind, { description: string; title: string }>

interface FilePreviewStateProps {
  kind: FilePreviewStateKind
  filePath?: AbsoluteFilePath
}

function FilePreviewState({ kind, filePath }: FilePreviewStateProps) {
  const { t } = useTranslation()
  const Icon =
    kind === 'unsupported'
      ? FileQuestion
      : kind === 'directory'
        ? FolderOpen
        : kind === 'invalid_path'
          ? FileX2
          : FileWarning
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
  filePath: AbsoluteFilePath
  metadata: FilePreviewFileMetadata
  plugin: FilePreviewPlugin
  pluginComponent: (props: FilePreviewPluginProps) => ReactNode
  refreshKey: number
  type: FilePreviewType
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
          className="relative flex h-11 min-h-11 shrink-0 items-center px-3 after:pointer-events-none after:absolute after:right-3 after:bottom-0 after:left-3 after:border-border after:border-b after:content-['']">
          <div className="flex min-w-0 flex-1 items-center gap-2">{header}</div>
          <FilePreviewToolbarPortalHost />
        </div>
        <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
      </FilePreviewLayout.Frame>
    </FilePreviewToolbarPortalProvider>
  )
}

function FilePreviewPluginRenderer({
  fileName,
  filePath,
  metadata,
  plugin,
  pluginComponent,
  refreshKey,
  type
}: FilePreviewPluginRendererProps) {
  const PluginComponent = pluginComponent

  return (
    <ErrorBoundary
      key={`${plugin.id}:${filePath}:${refreshKey}`}
      FallbackComponent={PluginErrorFallback}
      onError={(error) => logger.error(`Failed to render file preview plugin: ${plugin.id}`, error)}>
      <Suspense fallback={<FilePreviewLoading />}>
        <PluginComponent
          filePath={filePath}
          fileName={fileName}
          metadata={metadata}
          refreshKey={refreshKey}
          type={type}
        />
      </Suspense>
    </ErrorBoundary>
  )
}

export interface FilePreviewProps {
  filePath: AbsoluteFilePath
  header?: ReactNode
  refreshKey?: number
  type?: FilePreviewType
}

interface NormalizedFilePreviewTarget {
  fileName: string
  filePath: AbsoluteFilePath
}

type FilePreviewResolution =
  | { requestKey: string; status: 'directory' }
  | { requestKey: string; status: 'loading' }
  | { requestKey: string; status: 'load_error' }
  | { requestKey: string; status: 'unavailable' }
  | {
      file: NormalizedFilePreviewTarget
      metadata: FilePreviewFileMetadata
      plugin: FilePreviewPlugin | null
      pluginComponent: ((props: FilePreviewPluginProps) => ReactNode) | null
      requestKey: string
      status: 'ready'
    }

export function FilePreview({ filePath, header, refreshKey = 0, type = 'file' }: FilePreviewProps) {
  const file = useMemo(() => {
    try {
      const normalizedPath = normalizeFilePreviewPath(filePath)
      return { fileName: getFilePreviewFileName(normalizedPath), filePath: normalizedPath }
    } catch {
      return null
    }
  }, [filePath])
  const requestKey = file ? `${file.filePath}\0${refreshKey}` : ''
  const [resolution, setResolution] = useState<FilePreviewResolution>({ requestKey: '', status: 'loading' })

  useEffect(() => {
    if (!file) return

    let cancelled = false
    setResolution({ requestKey, status: 'loading' })

    // Resolve the plugin synchronously from the file path — no IPC needed.
    const candidatePlugin = resolveExtensionPlugin(file.filePath, filePreviewRegistry)

    void (async () => {
      try {
        // Run metadata IPC and plugin chunk loading in parallel.
        // Use WeakMap cache so load() is called at most once per plugin instance.
        // For unknown extensions we may need textFilePreviewPlugin as a fallback,
        // so load it too alongside the candidate plugin.
        const needsTextFallback = !candidatePlugin || TEXT_CONTENT_PLUGIN_IDS.has(candidatePlugin.id)
        const textPluginLoad =
          needsTextFallback && !loadedModules.has(textFilePreviewPlugin)
            ? (() => {
                const p = textFilePreviewPlugin.load()
                loadedModules.set(textFilePreviewPlugin, p)
                return p
              })()
            : (loadedModules.get(textFilePreviewPlugin) ?? Promise.resolve(null))

        const candidateLoad = (() => {
          if (!candidatePlugin) return null
          const existing = loadedModules.get(candidatePlugin)
          if (existing) return existing
          const promise = candidatePlugin.load()
          loadedModules.set(candidatePlugin, promise)
          return promise
        })()

        // Race metadata with the candidate plugin chunk load. Use Promise.allSettled
        // so a plugin chunk failure does not swallow the metadata result; the original
        // behavior surfaced plugin load failures through the ErrorBoundary (load_error),
        // not as an unavailable preview.
        const [metadataResult, candidateResult] = await Promise.allSettled([
          ipcApi.request('file.get_metadata', createFilePathHandle(file.filePath)),
          candidateLoad
        ])
        const metadata = metadataResult.status === 'fulfilled' ? metadataResult.value : null
        const candidateModule = candidateResult && candidateResult.status === 'fulfilled' ? candidateResult.value : null
        const candidateLoadError =
          candidateResult && candidateResult.status === 'rejected' ? candidateResult.reason : null

        // Load text plugin in parallel if needed (runs independently).
        if (needsTextFallback) {
          void textPluginLoad // fire and forget — we await it only when we need the result
        }
        if (cancelled) return

        if (metadataResult.status === 'rejected' || !metadata) {
          setResolution({ requestKey, status: 'unavailable' })
          return
        }

        if (metadata.kind === 'directory') {
          setResolution({ requestKey, status: 'directory' })
          return
        }

        // Accept/reject the candidate plugin based on metadata exactly as before.
        let plugin: FilePreviewPlugin | null = candidatePlugin
        let pluginModule = candidateModule
        let pluginLoadError: unknown = candidateLoadError
        if (!plugin || TEXT_CONTENT_PLUGIN_IDS.has(plugin.id)) {
          const isText = metadata.type === 'text'

          if (!plugin && isText) {
            plugin = textFilePreviewPlugin
            const textResult = await Promise.allSettled([textPluginLoad])
            if (textResult[0].status === 'fulfilled') {
              pluginModule = textResult[0].value
              pluginLoadError = null
            } else {
              pluginModule = null
              pluginLoadError = textResult[0].reason
            }
          } else if (plugin && !isText) {
            plugin = null
            pluginModule = null
            pluginLoadError = null
          }
        }

        // A plugin load failure produces a load_error state, mirroring the previous
        // ErrorBoundary fallback so existing tests still observe load_error.title.
        if (plugin && pluginLoadError) {
          logger.error(`Failed to load file preview plugin: ${plugin.id}`, pluginLoadError)
          setResolution({ requestKey, status: 'load_error' })
          return
        }

        // Pre-create a render-bound element factory so we never invoke lazy()
        // again on re-render — the chunk is already in `pluginModule`.
        const pluginComponent: ((props: FilePreviewPluginProps) => ReactNode) | null =
          plugin && pluginModule ? (props) => createElement(pluginModule.default, props) : null

        setResolution({ file, metadata, plugin, pluginComponent, requestKey, status: 'ready' })
      } catch {
        if (!cancelled) setResolution({ requestKey, status: 'unavailable' })
      }
    })()

    return () => {
      cancelled = true
    }
  }, [file, requestKey])

  let preview: ReactNode

  if (!file) {
    preview = <FilePreviewState kind="invalid_path" />
  } else if (resolution.requestKey !== requestKey || resolution.status === 'loading') {
    preview = <FilePreviewLoading />
  } else if (resolution.status === 'directory') {
    preview = <FilePreviewState kind="directory" />
  } else if (resolution.status === 'load_error') {
    preview = <FilePreviewState kind="load_error" />
  } else if (resolution.status === 'unavailable') {
    preview = <FilePreviewState kind="unavailable" />
  } else if (resolution.plugin && resolution.pluginComponent) {
    preview = (
      <FilePreviewPluginRenderer
        {...resolution.file}
        metadata={resolution.metadata}
        plugin={resolution.plugin}
        pluginComponent={resolution.pluginComponent}
        refreshKey={refreshKey}
        type={type}
      />
    )
  } else {
    preview = <FilePreviewState kind="unsupported" filePath={resolution.file.filePath} />
  }

  return <FilePreviewShell header={header}>{preview}</FilePreviewShell>
}
