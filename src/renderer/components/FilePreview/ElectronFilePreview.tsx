import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { type PreviewError, type PreviewSelection } from '@cherrystudio/file-preview/core'
import { Preview } from '@cherrystudio/file-preview/react'
import type { PreviewDiagnostic, PreviewResources } from '@cherrystudio/file-preview/react'
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

export default function ElectronFilePreview({
  filePath,
  fileName,
  metadata,
  refreshKey,
  onSelectionReference
}: FilePreviewPluginProps) {
  const { i18n, t } = useTranslation()
  const [previewError, setPreviewError] = useState<PreviewError | null>(null)
  useEffect(() => {
    setPreviewError(null)
  }, [filePath, refreshKey])
  const source = useMemo(
    () => createElectronPreviewSource(filePath, fileName, metadata),
    [filePath, fileName, metadata]
  )
  const onSelection = useCallback(
    (selection: PreviewSelection | null) => {
      onSelectionReference?.(selection ? createSelectionReference({ filePath, metadata, selection }) : null)
    },
    [filePath, metadata, onSelectionReference]
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
        refreshKey={refreshKey}
        locale={i18n.language}
        resources={resources}
        onSelection={onSelectionReference ? onSelection : undefined}
        onDiagnostic={onDiagnostic}
        onError={setPreviewError}
        onRequestOpen={onRequestOpen}
      />
      {previewError ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-6 z-10 flex justify-center">
          <div className="pointer-events-auto">
            <ErrorDetailAction
              error={previewError}
              message={t('file_preview.load_error.description')}
              source="file.preview"
              operation={`file.preview.${previewError.code}`}
            />
          </div>
        </div>
      ) : null}
    </div>
  )
}
