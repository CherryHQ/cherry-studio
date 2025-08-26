import { loggerService } from '@logger'
import TesseractLogo from '@renderer/assets/images/providers/Tesseract.js.png'
import { BUILTIN_OCR_PROVIDERS_MAP } from '@renderer/config/ocr'
import { getBuiltinOcrProviderLabel } from '@renderer/i18n/label'
import { useAppSelector } from '@renderer/store'
import { addOcrProvider, removeOcrProvider, setImageOcrProvider, updateOcrProviderConfig } from '@renderer/store/ocr'
import {
  ImageOcrProvider,
  isBuiltinOcrProvider,
  isBuiltinOcrProviderId,
  OcrProvider,
  OcrProviderConfig
} from '@renderer/types'
import { Avatar } from 'antd'
import { FileQuestionMarkIcon, MonitorIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useDispatch } from 'react-redux'

const logger = loggerService.withContext('useOcrProvider')

export const useOcrProviders = () => {
  const providers = useAppSelector((state) => state.ocr.providers)
  const imageProvider = useAppSelector((state) => state.ocr.imageProvider)
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

  const setImageProvider = (p: ImageOcrProvider) => {
    dispatch(setImageOcrProvider(p))
  }

  const getOcrProviderName = (p: OcrProvider) => {
    return isBuiltinOcrProvider(p) ? getBuiltinOcrProviderLabel(p.id) : p.name
  }

  const getOcrProviderLogo = (p: OcrProvider, size: number = 14) => {
    if (isBuiltinOcrProvider(p)) {
      switch (p.id) {
        case 'tesseract':
          return <Avatar size={size} src={TesseractLogo} />
        case 'system':
          return <MonitorIcon size={size} />
      }
    }
    return <FileQuestionMarkIcon size={size} />
  }

  return {
    providers,
    imageProvider,
    addProvider,
    removeProvider,
    setImageProvider,
    getOcrProviderName,
    getOcrProviderLogo
  }
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
