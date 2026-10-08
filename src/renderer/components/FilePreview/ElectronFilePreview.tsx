import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import type { PreviewSelection } from '@cherrystudio/file-preview/core'
import { Preview } from '@cherrystudio/file-preview/react'
import type { PreviewDiagnostic, PreviewResources } from '@cherrystudio/file-preview/react'
import { loggerService } from '@logger'
import { ipcApi } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'
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
  const source = useMemo(
    () => createElectronPreviewSource(filePath, fileName, metadata),
    [filePath, fileName, metadata]
  )
  const onSelection = useCallback(
    (selection: PreviewSelection | null) => {
      onSelectionReference?.(
        selection
          ? createSelectionReference({ filePath, metadata, anchor: selection.anchor, excerpt: selection.excerpt })
          : null
      )
    },
    [filePath, metadata, onSelectionReference]
  )
  const onDiagnostic = useCallback(
    (diagnostic: PreviewDiagnostic) => {
      const contextualLogger = loggerService.withContext(diagnostic.context)
      contextualLogger[diagnostic.level](diagnostic.message, { detail: diagnostic.detail })
      if (diagnostic.code === 'navigation_error') {
        toast.error(t('file_preview.pdf.navigation_error'))
      }
    },
    [t]
  )
  const onRequestOpen = useCallback(
    (reason: 'unsupported' | 'too_large') => {
      void safeOpen(createFilePathHandle(filePath)).catch((error: unknown) => {
        logger.error('Failed to open preview file externally', error instanceof Error ? error : { error })
        toast.error(
          t(reason === 'too_large' ? 'file_preview.pdf.too_large.open_error' : 'file_preview.unsupported.open_error')
        )
      })
    },
    [filePath, t]
  )

  return (
    <Preview
      source={source}
      refreshKey={refreshKey}
      locale={i18n.language}
      resources={resources}
      onSelection={onSelectionReference ? onSelection : undefined}
      onDiagnostic={onDiagnostic}
      onRequestOpen={onRequestOpen}
      onError={(error) => logger.error('Failed to open file preview', error)}
    />
  )
}
