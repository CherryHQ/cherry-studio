import { loggerService } from '@logger'
import { BUILTIN_OCR_PROVIDERS_MAP } from '@renderer/config/ocr'
import { useAppSelector } from '@renderer/store'
import { addOcrProvider, removeOcrProvider, updateOcrProviderConfig } from '@renderer/store/ocr'
import { isBuiltinOcrProviderId, OcrProvider, OcrProviderConfig } from '@renderer/types'
import { useTranslation } from 'react-i18next'
import { useDispatch } from 'react-redux'

const logger = loggerService.withContext('useOcrProvider')

export const useOcrProviders = () => {
  const providers = useAppSelector((state) => state.ocr.providers)
  const dispatch = useDispatch()
  const { t } = useTranslation()

  /**
   * 添加一个新的OCR服务提供者
   * @param provider - OCR提供者对象，包含id和其他配置信息
   * @throws {Error} 当尝试添加一个已存在ID的提供者时抛出错误
   */
  const addProvider = (provider: OcrProvider) => {
    if (providers.some((p) => p.id === provider.id)) {
      const msg = `Provider with id ${provider.id} already exists`
      logger.error(msg)
      window.message.error(t('ocr.error.provider.existing'))
      throw new Error(msg)
    }
    dispatch(addOcrProvider(provider))
  }

  /**
   * 移除一个OCR服务提供者
   * @param id - 要移除的OCR提供者ID
   * @throws {Error} 当尝试移除一个内置提供商时抛出错误
   */
  const removeProvider = (id: string) => {
    if (isBuiltinOcrProviderId(id)) {
      const msg = `Cannot remove builtin provider ${id}`
      logger.error(msg)
      window.message.error(t('ocr.error.provider.cannot_remove_builtin'))
      throw new Error(msg)
    }

    dispatch(removeOcrProvider(id))
  }

  return { providers, addProvider, removeProvider }
}

export const useOcrProvider = (id: string) => {
  const { t } = useTranslation()
  const dispatch = useDispatch()
  const { providers, addProvider } = useOcrProviders()
  let provider = providers.find((p) => p.id === id)

  // safely fallback
  if (!provider) {
    logger.error(`Ocr Provider ${id} not found`)
    window.message.error(t('ocr.error.provider.not_found'))
    if (isBuiltinOcrProviderId(id)) {
      try {
        addProvider(BUILTIN_OCR_PROVIDERS_MAP[id])
      } catch (e) {
        logger.warn(`Add ${BUILTIN_OCR_PROVIDERS_MAP[id].name} failed. Just use temp provider from config.`)
        window.message.warning(t('ocr.warning.provider.fallback', { name: BUILTIN_OCR_PROVIDERS_MAP[id].name }))
      } finally {
        provider = BUILTIN_OCR_PROVIDERS_MAP[id]
      }
    } else {
      logger.warn(`Fallback to tesseract`)
      window.message.warning(t('ocr.warning.provider.fallback', { name: 'Tesseract' }))
      provider = BUILTIN_OCR_PROVIDERS_MAP.tesseract
    }
  }

  const updateConfig = (update: Partial<OcrProviderConfig>) => {
    dispatch(updateOcrProviderConfig({ id: provider.id, update }))
  }

  return {
    provider,
    updateConfig
  }
}
