import { loggerService } from '@logger'
import { useMutation } from '@renderer/data/hooks/useDataApi'
import { useFiles } from '@renderer/hooks/useFiles'
import FileManager from '@renderer/services/FileManager'
import { bookExts, documentExts, textExts, thirdPartyApplicationExts } from '@shared/config/constant'
import type { FileItemData } from '@shared/data/types/knowledge'
import { useCallback } from 'react'

import type { AddAction } from './types'

const logger = loggerService.withContext('useAddFileAction')
const fileTypes = [...bookExts, ...thirdPartyApplicationExts, ...documentExts, ...textExts]

export const useAddFileAction = (baseId: string, baseDisabled: boolean): AddAction => {
  const { onSelectFile, selecting: isSelectingFile } = useFiles({ extensions: fileTypes })

  const { trigger: createItemsApi, isLoading: isCreatingItems } = useMutation(
    'POST',
    `/knowledge-bases/${baseId}/items`,
    {
      refresh: [`/knowledge-bases/${baseId}/items`]
    }
  )

  const handler = useCallback(async () => {
    if (baseDisabled || isSelectingFile) {
      return
    }

    const selectedFiles = await onSelectFile({ multipleSelections: true })
    if (selectedFiles.length === 0) {
      return
    }

    logger.debug('processFiles', selectedFiles)
    const startedAt = Date.now()
    logger.info('handleAddFile:start', { baseId, count: selectedFiles.length })

    try {
      const uploadedFiles = await FileManager.uploadFiles(selectedFiles)
      logger.info('handleAddFile:done', {
        baseId,
        count: uploadedFiles.length,
        durationMs: Date.now() - startedAt
      })

      await createItemsApi({
        body: {
          items: uploadedFiles.map((file) => ({
            type: 'file' as const,
            data: { file } satisfies FileItemData
          }))
        }
      })
    } catch (error) {
      logger.error('handleAddFile:failed', error as Error, {
        baseId,
        durationMs: Date.now() - startedAt
      })
      throw error
    }
  }, [baseDisabled, isSelectingFile, onSelectFile, baseId, createItemsApi])

  return {
    handler,
    disabled: baseDisabled,
    loading: isSelectingFile || isCreatingItems
  }
}
