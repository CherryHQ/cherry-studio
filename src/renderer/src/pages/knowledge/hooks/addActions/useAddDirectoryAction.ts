import { loggerService } from '@logger'
import { dataApiService } from '@renderer/data/DataApiService'
import { useMutation } from '@renderer/data/hooks/useDataApi'
import { useCallback } from 'react'

import { buildDirectoryPayload } from '../../utils/buildDirectoryPayload'
import type { AddAction } from './types'

const logger = loggerService.withContext('useAddDirectoryAction')

export const useAddDirectoryAction = (baseId: string, baseDisabled: boolean): AddAction => {
  const { trigger: createItemsApi, isLoading: isCreatingItems } = useMutation(
    'POST',
    `/knowledge-bases/${baseId}/items`,
    {
      refresh: [`/knowledge-bases/${baseId}/items`]
    }
  )

  const handler = useCallback(async () => {
    if (baseDisabled || isCreatingItems) {
      return
    }

    const path = await window.api.file.selectFolder()
    logger.info('Selected directory:', { path })

    if (!path) {
      return
    }

    try {
      const payload = await buildDirectoryPayload(path)

      if (!payload) {
        window.toast.info('No files found in the selected directory.')
        return
      }

      const directoryResult = await createItemsApi({
        body: { items: [payload.directoryItem] }
      })

      const directory = directoryResult.items[0]
      if (!directory) {
        return
      }

      if (payload.childItems.length > 0) {
        try {
          await createItemsApi({
            body: {
              items: payload.childItems.map((item) => ({
                ...item,
                parentId: directory.id
              }))
            }
          })
        } catch (childError) {
          logger.error('Failed to create child items, cleaning up directory container', childError as Error)
          await dataApiService.delete(`/knowledge-items/${directory.id}`)
          throw childError
        }
      }
    } catch (error) {
      logger.error('Failed to add directory via v2 API', error as Error)
      throw error
    }
  }, [baseDisabled, isCreatingItems, createItemsApi])

  return {
    handler,
    disabled: baseDisabled,
    loading: isCreatingItems
  }
}
