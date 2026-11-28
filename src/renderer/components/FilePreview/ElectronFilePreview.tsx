import { useCallback, useMemo, useState } from 'react'
import { I18nextProvider, useTranslation } from 'react-i18next'

import { type PreviewError, type PreviewSelection } from '@cherrystudio/file-preview/core'
import { Preview } from '@cherrystudio/file-preview/react'
import type { PreviewDiagnostic, PreviewOptions, PreviewResources } from '@cherrystudio/file-preview/react'
import { loggerService } from '@logger'
import { ErrorDetailAction } from '@renderer/components/ErrorDetailAction'
import { ipcApi } from '@renderer/ipc'
import { toastInlineError } from '@renderer/services/toast'
import { safeOpen } from '@renderer/utils/file/safeOpen'
import { AbsoluteFilePathSchema } from '@shared/types/file'
import { createFilePathHandle } from '@shared/utils/file'

import { createElectronPreviewSource } from './electronPreviewSource'
import { createSelectionReference } from './selectionReference'
import type { FilePreviewPluginProps } from './types'

const logger = loggerService.withContext('FilePreview')
const staticResources: PreviewResources = {
  async readPdfResource(kind, name) {
    const { content } = await ipcApi.request('pdfjs.resource.read', { kind, name })
    return content
  }
}

/**
 * Resolves a project-relative reference (PPTD pages/media) against the
 * previewed file's directory. Rejects absolute paths and any `..` segment so
 * a project can never read outside its own directory.
 */
export function resolveProjectRelativePath(manifestPath: string, relativePath: string): string | null {
  const separator = manifestPath.includes('\\') ? '\\' : '/'
  const normalizedManifest = manifestPath.replace(/\\/g, '/')
  const projectDir = normalizedManifest.slice(0, normalizedManifest.lastIndexOf('/'))
  const relative = relativePath.trim().replace(/\\/g, '/')
  if (!relative || relative.startsWith('/') || /^[a-zA-Z]:\//.test(relative)) {
    return null
  }
  const segments: string[] = []
  for (const segment of relative.split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') return null
    segments.push(segment)
  }
  if (segments.length === 0) {
    return null
  }
  const joined = `${projectDir}/${segments.join('/')}`
  return separator === '\\' ? joined.replace(/\//g, '\\') : joined
}
/**
 * Word previews fit the pane instead of a fixed page width. A page rendered at actual size is wider
 * than a docked pane, so the pane has to grow to the paper and the leftover width shows as gutters.
 */
const previewOptions: PreviewOptions = { docx: { initialZoom: 'fit-width' } }

export default function ElectronFilePreview({
  filePath,
  fileName,
  metadata,
  metadataRequest,
  refreshKey,
  onSelectionReference
}: FilePreviewPluginProps) {
  const { i18n, t } = useTranslation()
  const sourceMetadata = metadataRequest ?? metadata
  const source = useMemo(
    () => createElectronPreviewSource(filePath, fileName, sourceMetadata),
    [filePath, fileName, sourceMetadata]
  )
  const resources = useMemo<PreviewResources>(
    () => ({
      ...staticResources,
      async readProjectFile(relativePath, signal) {
        const resolved = resolveProjectRelativePath(filePath, relativePath)
        if (!resolved) {
          throw new Error(`Project path escapes the project directory: ${relativePath}`)
        }
        signal?.throwIfAborted()
        const { content } = await ipcApi.request('file.read', {
          handle: createFilePathHandle(AbsoluteFilePathSchema.parse(resolved)),
          options: { mode: 'full', encoding: 'binary' }
        })
        signal?.throwIfAborted()
        return content
      }
    }),
    [filePath]
  )
  const previewRefreshKey = metadataRequest ? undefined : refreshKey
  // Keyed like Preview's own failure, so a reload of the same file drops the stale action.
  const [previewError, setPreviewError] = useState<{
    error: PreviewError
    source: typeof source
    refreshKey: number | undefined
  } | null>(null)
  const currentError =
    previewError?.source === source && previewError.refreshKey === previewRefreshKey ? previewError.error : null
  // A size limit is a preview policy, not a fault for Doctor.
  const faultError = currentError?.code === 'too_large' ? null : currentError
  const onSelection = useCallback(
    (selection: PreviewSelection | null) => {
      if (!selection) {
        onSelectionReference?.(null)
      } else if (typeof sourceMetadata === 'function') {
        const metadataPromise = sourceMetadata()
        void metadataPromise.then(
          (loadedMetadata) => {
            if (sourceMetadata() !== metadataPromise || loadedMetadata?.kind !== 'file') return
            onSelectionReference?.(createSelectionReference({ filePath, metadata: loadedMetadata, selection }))
          },
          () => {}
        )
      } else {
        onSelectionReference?.(createSelectionReference({ filePath, metadata: sourceMetadata, selection }))
      }
    },
    [filePath, sourceMetadata, onSelectionReference]
  )
  const onDiagnostic = useCallback(
    (diagnostic: PreviewDiagnostic) => {
      const contextualLogger = loggerService.withContext(diagnostic.context)
      contextualLogger[diagnostic.level](
        diagnostic.message,
        diagnostic.detail instanceof Error ? diagnostic.detail : { detail: diagnostic.detail }
      )
      if (diagnostic.code === 'navigation_error') {
        const cause = diagnostic.detail instanceof Error ? diagnostic.detail : new Error(diagnostic.message)
        void import('@renderer/services/AppErrorDetailService')
          .then(({ toastAppError }) => {
            toastAppError(t('file_preview.pdf.navigation_error'), cause, {
              source: 'file.preview',
              operation: 'file.preview.navigation'
            })
          })
          .catch(() => toastInlineError(t('file_preview.pdf.navigation_error')))
      }
    },
    [t]
  )
  const onRequestOpen = useCallback(() => {
    void safeOpen(createFilePathHandle(filePath)).catch((error: unknown) => {
      const normalized = error instanceof Error ? error : new Error(String(error))
      logger.error('Failed to open preview file externally', normalized)
      void import('@renderer/services/AppErrorDetailService')
        .then(({ toastAppError }) => {
          toastAppError(t('file_preview.open_error'), normalized, {
            source: 'file.preview',
            operation: 'file.preview.open'
          })
        })
        .catch(() => toastInlineError(t('file_preview.open_error')))
    })
  }, [filePath, t])

  return (
    <Preview
      source={source}
      refreshKey={previewRefreshKey}
      locale={i18n.language}
      resources={resources}
      options={previewOptions}
      onSelection={onSelectionReference ? onSelection : undefined}
      onDiagnostic={onDiagnostic}
      onError={(error) => setPreviewError({ error, source, refreshKey: previewRefreshKey })}
      onRequestOpen={onRequestOpen}
      errorDetail={
        // Preview renders this under its own i18n instance, which lacks app keys such as `common.detail`.
        faultError ? (
          <I18nextProvider i18n={i18n}>
            <ErrorDetailAction
              error={faultError}
              message={t('file_preview.load_error.description')}
              source="file.preview"
              operation={`file.preview.${faultError.code}`}
            />
          </I18nextProvider>
        ) : undefined
      }
    />
  )
}
