import { loggerService } from '@logger'
import PaddleocrLogo from '@renderer/assets/images/providers/paddleocr.png'
import TesseractLogo from '@renderer/assets/images/providers/Tesseract.js.png'
import { BUILTIN_OCR_PROVIDERS_MAP, DEFAULT_OCR_PROVIDER } from '@renderer/config/ocr'
import { getBuiltinOcrProviderLabel } from '@renderer/i18n/label'
import { useAppSelector } from '@renderer/store'
import { addOcrProvider, removeOcrProvider, setImageOcrProviderId, updateOcrProviderConfig } from '@renderer/store/ocr'
import {
  ImageOcrProvider,
  isBuiltinOcrProvider,
  isBuiltinOcrProviderId,
  isImageOcrProvider,
  OcrProvider,
  OcrProviderConfig
} from '@renderer/types'
import { Avatar } from 'antd'
import { FileQuestionMarkIcon, MonitorIcon } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useDispatch } from 'react-redux'

const logger = loggerService.withContext('useOcrProvider')

export const useOcrProviders = () => {
  const providers = useAppSelector((state) => state.ocr.providers)
  const imageProviders = providers.filter(isImageOcrProvider)
  const imageProviderId = useAppSelector((state) => state.ocr.imageProviderId)
  const [imageProvider, setImageProvider] = useState<ImageOcrProvider>(DEFAULT_OCR_PROVIDER.image)
  const dispatch = useDispatch()
  const { t } = useTranslation()

  /**
   * 添加一个新的OCR服务提供者
   * @param provider - OCR提供者对象，包含id和其他配置信息
   * @throws {Error} 当尝试添加一个已存在ID的提供者时抛出错误
   */
  const addProvider = useCallback(
    (provider: OcrProvider) => {
      if (providers.some((p) => p.id === provider.id)) {
        const msg = `Provider with id ${provider.id} already exists`
        logger.error(msg)
        window.toast.error(t('ocr.error.provider.existing'))
        throw new Error(msg)
      }
      dispatch(addOcrProvider(provider))
    },
    [dispatch, providers, t]
  )

  /**
   * 移除一个OCR服务提供者
   * @param id - 要移除的OCR提供者ID
   * @throws {Error} 当尝试移除一个内置提供商时抛出错误
   */
  const removeProvider = (id: string) => {
    if (isBuiltinOcrProviderId(id)) {
      const msg = `Cannot remove builtin provider ${id}`
      logger.error(msg)
      window.toast.error(t('ocr.error.provider.cannot_remove_builtin'))
      throw new Error(msg)
    }

    dispatch(removeOcrProvider(id))
  }

  const setImageProviderId = useCallback(
    (id: string) => {
      dispatch(setImageOcrProviderId(id))
    },
    [dispatch]
  )

  const getOcrProviderName = (p: OcrProvider) => {
    return isBuiltinOcrProvider(p) ? getBuiltinOcrProviderLabel(p.id) : p.name
  }

  const OcrProviderLogo = ({ provider: p, size = 14 }: { provider: OcrProvider; size?: number }) => {
    if (isBuiltinOcrProvider(p)) {
      switch (p.id) {
        case 'tesseract':
          return <Avatar size={size} src={TesseractLogo} />
        case 'system':
          return <MonitorIcon size={size} />
        case 'paddleocr':
          return <Avatar size={size} src={PaddleocrLogo} />
      }
    }
    return <FileQuestionMarkIcon size={size} />
  }

  useEffect(() => {
    const actualImageProvider = imageProviders.find((p) => p.id === imageProviderId)
    if (!actualImageProvider) {
      if (isBuiltinOcrProviderId(imageProviderId)) {
        logger.warn(`Builtin ocr provider ${imageProviderId} not exist. Will add it to providers.`)
        addProvider(BUILTIN_OCR_PROVIDERS_MAP[imageProviderId])
      }
      setImageProviderId(DEFAULT_OCR_PROVIDER.image.id)
      setImageProvider(DEFAULT_OCR_PROVIDER.image)
    } else {
      setImageProviderId(actualImageProvider.id)
      setImageProvider(actualImageProvider)
    }
  }, [addProvider, imageProviderId, imageProviders, setImageProviderId])

  return {
    providers,
    imageProvider,
    addProvider,
    removeProvider,
    setImageProviderId,
    getOcrProviderName,
    OcrProviderLogo
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
    window.toast.error(t('ocr.error.provider.not_found'))
    if (isBuiltinOcrProviderId(id)) {
      try {
        addProvider(BUILTIN_OCR_PROVIDERS_MAP[id])
      } catch (e) {
        logger.warn(`Add ${BUILTIN_OCR_PROVIDERS_MAP[id].name} failed. Just use temp provider from config.`)
        window.toast.warning(t('ocr.warning.provider.fallback', { name: BUILTIN_OCR_PROVIDERS_MAP[id].name }))
      } finally {
        provider = BUILTIN_OCR_PROVIDERS_MAP[id]
      }
    } else {
      logger.warn(`Fallback to tesseract`)
      window.toast.warning(t('ocr.warning.provider.fallback', { name: 'Tesseract' }))
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
