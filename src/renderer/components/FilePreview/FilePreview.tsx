import { FileQuestion, FileWarning, FileX2, FolderOpen, LoaderCircle } from 'lucide-react'
import {
  type ComponentType,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import { ErrorBoundary } from 'react-error-boundary'
import { useTranslation } from 'react-i18next'

import { FilePreviewLayout } from '@cherrystudio/file-preview/react'
import { EmptyState } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { ipcApi } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'
import { safeOpen } from '@renderer/utils/file/safeOpen'
import { getFilePreviewFileName, normalizeFilePreviewPath } from '@renderer/utils/filePreview'
import type { AbsoluteFilePath } from '@shared/types/file'
import { createFilePathHandle } from '@shared/utils/file'

import { filePreviewRegistry, resolveExtensionPlugin } from './filePreviewRegistry'
import { textFilePreviewPlugin } from './plugins/text/textFilePreviewPlugin'
import type {
  FilePreviewFileMetadata,
  FilePreviewMetadataRequest,
  FilePreviewPlugin,
  FilePreviewPluginProps,
  FilePreviewType
} from './types'

const logger = loggerService.withContext('FilePreview')
const TEXT_CONTENT_PLUGIN_IDS = new Set(['html', 'markdown', 'text'])

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
    void safeOpen(createFilePathHandle(openablePath)).catch(() => toast.error(t('file_preview.open_error')))
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
        <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
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
  metadataRequest?: FilePreviewMetadataRequest
  onSelectionReference?: FilePreviewPluginProps['onSelectionReference']
  onLineComment?: FilePreviewPluginProps['onLineComment']
  plugin: { descriptor: FilePreviewPlugin; component: ComponentType<FilePreviewPluginProps> }
  refreshKey: number
  type: FilePreviewType
}

interface PreloadedFilePreviewPlugin {
  descriptor: FilePreviewPlugin
  modulePromise: ReturnType<FilePreviewPlugin['load']>
}

function preloadFilePreviewPlugin(descriptor: FilePreviewPlugin): PreloadedFilePreviewPlugin {
  const modulePromise = Promise.resolve().then(() => descriptor.load())
  // Metadata may reject the candidate before its module settles.
  void modulePromise.catch(() => {})
  return { descriptor, modulePromise }
}

function FilePreviewPluginRenderer({
  fileName,
  filePath,
  metadata,
  metadataRequest,
  onSelectionReference,
  onLineComment,
  plugin,
  refreshKey,
  type
}: FilePreviewPluginRendererProps) {
  const PluginPreview = plugin.component

  return (
    <ErrorBoundary
      key={`${plugin.descriptor.id}:${filePath}`}
      resetKeys={[refreshKey]}
      FallbackComponent={PluginErrorFallback}
      onError={(error) => logger.error(`Failed to render file preview plugin: ${plugin.descriptor.id}`, error)}>
      <PluginPreview
        filePath={filePath}
        fileName={fileName}
        metadata={metadata}
        metadataRequest={metadataRequest}
        onSelectionReference={onSelectionReference}
        onLineComment={onLineComment}
        refreshKey={refreshKey}
        type={type}
      />
    </ErrorBoundary>
  )
}

export interface FilePreviewProps {
  filePath: AbsoluteFilePath
  header?: ReactNode
  refreshKey?: number
  type?: FilePreviewType
  /** See {@link FilePreviewPluginProps.onSelectionReference}; callbacks from obsolete metadata are ignored. */
  onSelectionReference?: FilePreviewPluginProps['onSelectionReference']
  onLineComment?: FilePreviewPluginProps['onLineComment']
}

interface NormalizedFilePreviewTarget {
  fileName: string
  filePath: AbsoluteFilePath
}

type FilePreviewResolution =
  | { requestKey: string; status: 'directory' }
  | { requestKey: string; status: 'loading' }
  | { requestKey: string; status: 'unavailable' }
  | { requestKey: string; status: 'load_error' }
  | {
      file: NormalizedFilePreviewTarget
      metadata: FilePreviewFileMetadata
      metadataPromise: ReturnType<FilePreviewMetadataRequest>
      plugin: FilePreviewPluginRendererProps['plugin'] | null
      requestKey: string
      status: 'ready'
    }

export function FilePreview({
  filePath,
  header,
  refreshKey = 0,
  type = 'file',
  onSelectionReference,
  onLineComment
}: FilePreviewProps) {
  const file = useMemo(() => {
    try {
      const normalizedPath = normalizeFilePreviewPath(filePath)
      return { fileName: getFilePreviewFileName(normalizedPath), filePath: normalizedPath }
    } catch {
      return null
    }
  }, [filePath])
  const metadataRequest = useMemo(() => {
    if (!file) return null
    let promise: ReturnType<FilePreviewMetadataRequest> | undefined
    return {
      key: `${file.filePath}\0${refreshKey}`,
      start() {
        promise = Promise.resolve().then(() => ipcApi.request('file.get_metadata', createFilePathHandle(file.filePath)))
        // The host and retained source attach in passive effects, after this layout effect.
        void promise.catch(() => {})
        return promise
      },
      read() {
        if (!promise) throw new Error('Preview metadata request has not started')
        return promise
      }
    }
  }, [file, refreshKey])
  const requestKey = metadataRequest?.key ?? ''
  const [resolution, setResolution] = useState<FilePreviewResolution>({ requestKey: '', status: 'loading' })
  const selectionRequestRef = useRef<ReturnType<FilePreviewMetadataRequest> | null>(null)
  useLayoutEffect(() => {
    selectionRequestRef.current = metadataRequest?.start() ?? null
    return () => {
      selectionRequestRef.current = null
    }
  }, [metadataRequest])
  const reportSelection = useCallback<NonNullable<FilePreviewPluginProps['onSelectionReference']>>(
    (reference) => {
      // A retained plugin can finish an old selection while new metadata is pending.
      // Only the resolution belonging to the current request may publish results.
      if (resolution.status === 'ready' && selectionRequestRef.current === resolution.metadataPromise) {
        onSelectionReference?.(reference)
      }
    },
    [onSelectionReference, resolution]
  )

  useEffect(() => {
    if (!file || !metadataRequest) return

    let cancelled = false

    void (async () => {
      try {
        const metadataPromise = metadataRequest.read()
        const candidateDescriptor = resolveExtensionPlugin(file.filePath, filePreviewRegistry)
        const candidatePlugin = candidateDescriptor ? preloadFilePreviewPlugin(candidateDescriptor) : null
        const metadata = await metadataPromise
        if (cancelled) return

        if (!metadata) {
          setResolution({ requestKey, status: 'unavailable' })
          return
        }

        if (metadata.kind === 'directory') {
          setResolution({ requestKey, status: 'directory' })
          return
        }

        let plugin = candidatePlugin
        if (!plugin || TEXT_CONTENT_PLUGIN_IDS.has(plugin.descriptor.id)) {
          const isText = metadata.type === 'text'

          if (!plugin && isText) {
            plugin = preloadFilePreviewPlugin(textFilePreviewPlugin)
          } else if (plugin && !isText) {
            plugin = null
          }
        }

        const module = plugin
          ? await plugin.modulePromise.catch((error: unknown) => {
              logger.error(
                `Failed to load file preview plugin: ${plugin.descriptor.id}`,
                error instanceof Error ? error : new Error(String(error))
              )
              return null
            })
          : null
        if (cancelled) return
        if (plugin && !module) {
          setResolution({ requestKey, status: 'load_error' })
          return
        }
        setResolution({
          file,
          metadata,
          metadataPromise,
          requestKey,
          status: 'ready',
          plugin: plugin && module ? { descriptor: plugin.descriptor, component: module.default } : null
        })
      } catch {
        if (!cancelled) setResolution({ requestKey, status: 'unavailable' })
      }
    })()

    return () => {
      cancelled = true
    }
  }, [file, metadataRequest, requestKey])

  let preview: ReactNode

  if (!file) {
    preview = <FilePreviewState kind="invalid_path" />
  } else if (
    resolution.status === 'loading' ||
    (resolution.requestKey !== requestKey &&
      !(resolution.status === 'ready' && resolution.file.filePath === file.filePath))
  ) {
    preview = <FilePreviewLoading />
  } else if (resolution.status === 'directory') {
    preview = <FilePreviewState kind="directory" />
  } else if (resolution.status === 'unavailable') {
    preview = <FilePreviewState kind="unavailable" />
  } else if (resolution.status === 'load_error') {
    preview = <FilePreviewState kind="load_error" />
  } else if (resolution.plugin) {
    preview = (
      <FilePreviewPluginRenderer
        {...resolution.file}
        metadata={resolution.metadata}
        metadataRequest={metadataRequest?.read}
        onSelectionReference={onSelectionReference ? reportSelection : undefined}
        onLineComment={onLineComment}
        plugin={resolution.plugin}
        refreshKey={refreshKey}
        type={type}
      />
    )
  } else {
    preview = <FilePreviewState kind="unsupported" filePath={resolution.file.filePath} />
  }

  return <FilePreviewLayout.Shell header={header}>{preview}</FilePreviewLayout.Shell>
}
