import { EmptyState } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { getFilePreviewFileName, normalizeFilePreviewPath } from '@renderer/utils/filePreview'
import type { FilePath } from '@shared/types/file'
import { FileQuestion, FileWarning, FileX2, LoaderCircle } from 'lucide-react'
import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { ErrorBoundary } from 'react-error-boundary'
import { useTranslation } from 'react-i18next'

import { FilePreviewLayout } from './FilePreviewLayout'
import { filePreviewRegistry, resolveExtensionPlugin } from './filePreviewRegistry'
import type { FilePreviewPlugin } from './types'

const logger = loggerService.withContext('FilePreview')

type FilePreviewStateKind = 'invalid_path' | 'load_error' | 'probe_error' | 'unsupported'

const FILE_PREVIEW_STATE_KEYS = {
  invalid_path: {
    description: 'file_preview.invalid_path.description',
    title: 'file_preview.invalid_path.title'
  },
  load_error: {
    description: 'file_preview.load_error.description',
    title: 'file_preview.load_error.title'
  },
  probe_error: {
    description: 'file_preview.probe_error.description',
    title: 'file_preview.probe_error.title'
  },
  unsupported: {
    description: 'file_preview.unsupported.description',
    title: 'file_preview.unsupported.title'
  }
} as const satisfies Record<FilePreviewStateKind, { description: string; title: string }>

interface FilePreviewStateProps {
  kind: FilePreviewStateKind
}

function FilePreviewState({ kind }: FilePreviewStateProps) {
  const { t } = useTranslation()
  const Icon = kind === 'unsupported' ? FileQuestion : kind === 'invalid_path' ? FileX2 : FileWarning
  const keys = FILE_PREVIEW_STATE_KEYS[kind]

  return (
    <FilePreviewLayout.Frame>
      <FilePreviewLayout.Content>
        <EmptyState icon={Icon} title={t(keys.title)} description={t(keys.description)} className="h-full" />
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
}

function FilePreviewPluginRenderer({ fileName, filePath, plugin }: FilePreviewPluginRendererProps) {
  const PluginPreview = useMemo(() => lazy(plugin.load), [plugin])

  return (
    <ErrorBoundary
      key={`${plugin.id}:${filePath}`}
      FallbackComponent={PluginErrorFallback}
      onError={(error) => logger.error(`Failed to render file preview plugin: ${plugin.id}`, error)}>
      <Suspense fallback={<FilePreviewLoading />}>
        <PluginPreview filePath={filePath} fileName={fileName} />
      </Suspense>
    </ErrorBoundary>
  )
}

interface TextFallbackPreviewProps {
  fileName: string
  filePath: FilePath
  plugin: FilePreviewPlugin
}

function TextFallbackPreview({ fileName, filePath, plugin }: TextFallbackPreviewProps) {
  const [state, setState] = useState<'binary' | 'error' | 'pending' | 'text'>('pending')

  useEffect(() => {
    let cancelled = false

    void window.api.file
      .isTextFile(filePath)
      .then((isText) => {
        if (!cancelled) setState(isText ? 'text' : 'binary')
      })
      .catch((error: unknown) => {
        if (cancelled) return
        const normalized = error instanceof Error ? error : new Error(String(error))
        logger.error(`Failed to detect preview file type: ${filePath}`, normalized)
        setState('error')
      })

    return () => {
      cancelled = true
    }
  }, [filePath])

  if (state === 'pending') return <FilePreviewLoading />
  if (state === 'error') return <FilePreviewState kind="probe_error" />
  if (state === 'binary') return <FilePreviewState kind="unsupported" />
  return <FilePreviewPluginRenderer fileName={fileName} filePath={filePath} plugin={plugin} />
}

interface FilePreviewProps {
  filePath: FilePath
}

export function FilePreview({ filePath }: FilePreviewProps) {
  const file = useMemo(() => {
    try {
      const normalizedPath = normalizeFilePreviewPath(filePath)
      return { fileName: getFilePreviewFileName(normalizedPath), filePath: normalizedPath }
    } catch {
      return null
    }
  }, [filePath])

  if (!file) return <FilePreviewState kind="invalid_path" />

  const extensionPlugin = resolveExtensionPlugin(file.filePath, filePreviewRegistry)
  if (extensionPlugin) {
    return <FilePreviewPluginRenderer {...file} plugin={extensionPlugin} />
  }

  if (filePreviewRegistry.textFallbackPlugin) {
    return <TextFallbackPreview key={file.filePath} {...file} plugin={filePreviewRegistry.textFallbackPlugin} />
  }

  return <FilePreviewState kind="unsupported" />
}
