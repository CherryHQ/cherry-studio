import { loggerService } from '@logger'
import * as OcrService from '@renderer/services/ocr/OcrService'
import type { ImageFileMetadata, OcrTaskResult, OcrTaskStartResult, SupportedOcrFile } from '@renderer/types'
import { isImageFileMetadata } from '@renderer/types'
import { formatErrorMessage } from '@renderer/utils/error'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

import { useOcrProviders } from './useOcrProvider'

const logger = loggerService.withContext('useOcr')
const OCR_STATUS_POLL_INTERVAL_MS = 1000

const sleep = async (ms: number) => {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

export const useOcr = () => {
  const { t } = useTranslation()
  const { imageProvider } = useOcrProviders()

  const startImageOcr = useCallback(
    async (image: ImageFileMetadata): Promise<OcrTaskStartResult> => {
      logger.debug('startImageOcr', { config: imageProvider.config })
      return OcrService.start(image, imageProvider)
    },
    [imageProvider]
  )

  const waitForImageOcrResult = useCallback(
    async (taskId: string): Promise<OcrTaskResult> => {
      while (true) {
        const status = await OcrService.getStatus(taskId, imageProvider)

        if (status.status === 'completed') {
          return OcrService.getResult(taskId, imageProvider)
        }

        if (status.status === 'failed') {
          throw new Error(`OCR task ${taskId} failed`)
        }

        await sleep(OCR_STATUS_POLL_INTERVAL_MS)
      }
    },
    [imageProvider]
  )

  const start = async (file: SupportedOcrFile) => {
    try {
      if (isImageFileMetadata(file)) {
        return await startImageOcr(file)
      }

      // @ts-expect-error all types should be covered
      throw new Error(t('ocr.file.not_supported', { type: file.type }))
    } catch (e) {
      logger.error('Failed to start ocr.', e as Error)
      window.toast.error(t('ocr.error.unknown') + ': ' + formatErrorMessage(e))
      throw e
    }
  }

  const getResult = async (taskId: string, file: SupportedOcrFile) => {
    const getTaskResult = async () => {
      try {
        if (isImageFileMetadata(file)) {
          return await waitForImageOcrResult(taskId)
        }

        // @ts-expect-error all types should be covered
        throw new Error(t('ocr.file.not_supported', { type: file.type }))
      } catch (e) {
        logger.error('Failed to finish ocr.', e as Error)
        window.toast.error(t('ocr.error.unknown') + ': ' + formatErrorMessage(e))
        throw e
      }
    }

    const promise = getTaskResult()
    window.toast.loading({ title: t('ocr.processing'), promise })
    return promise
  }

  return {
    start,
    getResult
  }
}
