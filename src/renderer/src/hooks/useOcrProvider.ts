import { loggerService } from '@logger'
import { useAppSelector } from '@renderer/store'
import { updateOcrProviderConfig } from '@renderer/store/ocr'
import { OcrProviderConfig } from '@renderer/types'
import { useTranslation } from 'react-i18next'
import { useDispatch } from 'react-redux'

const logger = loggerService.withContext('useOcrProvider')

export const useOcrProvider = (id: string) => {
  const { t } = useTranslation()
  const dispatch = useDispatch()
  const providers = useAppSelector((state) => state.ocr.providers)
  const provider = providers.find((p) => p.id === id)

  if (!provider) {
    logger.error(`Ocr Provider ${id} not found`)
    window.message.error(t('ocr.provider.not_found'))
    throw new Error(`Ocr Provider ${id} not found`)
  }

  const updateConfig = (update: Partial<OcrProviderConfig>) => {
    dispatch(updateOcrProviderConfig({ id: provider.id, update }))
  }

  return {
    provider,
    updateConfig
  }
}
