import { useCallback } from 'react'

import { dataApiService } from '@data/DataApiService'
import { loggerService } from '@logger'
import type { Model } from '@shared/data/types/model'

import { useProviderModelSync } from './useProviderModelSync'

const logger = loggerService.withContext('ProviderSettings:CherryInSetup')

export function useCherryInSetup(providerId: string) {
  const { syncProviderModels } = useProviderModelSync(providerId)
  const completeSetup = useCallback(
    async (isCurrent: () => boolean): Promise<Model[] | undefined> => {
      if (!isCurrent()) return

      let models: Model[]
      try {
        models = await syncProviderModels()
      } catch (error) {
        if (!isCurrent()) return
        logger.error('Failed to sync CherryIN models after login', error as Error)
        throw error
      }
      if (!isCurrent()) return

      try {
        await dataApiService.post('/assistants:initialize-cherryin-official', { body: {} })
      } catch (error) {
        logger.error('Failed to initialize CherryIN official assistants', error as Error)
      }
      return isCurrent() ? models : undefined
    },
    [syncProviderModels]
  )
  return { completeSetup }
}
