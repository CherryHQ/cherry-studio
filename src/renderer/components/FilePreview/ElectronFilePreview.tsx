import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { type PreviewError, type PreviewSelection } from '@cherrystudio/file-preview/core'
import { Preview } from '@cherrystudio/file-preview/react'
import type { PreviewDiagnostic, PreviewOptions, PreviewResources } from '@cherrystudio/file-preview/react'
import { loggerService } from '@logger'
import { ErrorDetailAction } from '@renderer/components/ErrorDetailAction'
import { ipcApi } from '@renderer/ipc'
import { safeOpen } from '@renderer/utils/file/safeOpen'
import { createFilePathHandle } from '@shared/utils/file'

import { createElectronPreviewSource } from './electronPreviewSource'
import { createSelectionReference } from './selectionReference'
import type { FilePreviewPluginProps } from './types'

const logger = loggerService.withContext('FilePreview')
const resources: PreviewResources = {
  async readPdfResource(kind, name) {
    const { content } = await ipcApi.request('pdfjs.resource.read', { kind, name })
    return content
  }
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
        void import('@renderer/services/AppErrorDetailService').then(({ toastAppError }) => {
          toastAppError(t('file_preview.pdf.navigation_error'), cause, {
            source: 'file.preview',
            operation: 'file.preview.navigation'
          })
        })
      }
    },
    [t]
  )
  const onRequestOpen = useCallback(() => {
    void safeOpen(createFilePathHandle(filePath)).catch((error: unknown) => {
      const normalized = error instanceof Error ? error : new Error(String(error))
      logger.error('Failed to open preview file externally', normalized)
      void import('@renderer/services/AppErrorDetailService').then(({ toastAppError }) => {
        toastAppError(t('file_preview.open_error'), normalized, {
          source: 'file.preview',
          operation: 'file.preview.open'
        })
      })
    })
  }, [filePath, t])

  return (
    <div className="relative h-full min-h-0">
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
      />
      {faultError ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-6 z-10 flex justify-center">
          <div className="pointer-events-auto">
            <ErrorDetailAction
              error={faultError}
              message={t('file_preview.load_error.description')}
              source="file.preview"
              operation={`file.preview.${faultError.code}`}
            />
          </div>
        </div>
      ) : null}
    </div>
  )
}
