import type { FileMetadata } from '@shared/data/types/file/legacyFileMetadata'
import { isImageFileMetadata } from '@shared/data/types/file/legacyFileMetadata'
import {
  type BuiltinOcrProvider,
  type BuiltinOcrProviderId,
  BuiltinOcrProviderIds,
  type ImageOcrProvider,
  type OcrApiProvider,
  type OcrOvProvider,
  type OcrPpocrProvider,
  type OcrProvider,
  type OcrProviderApiConfig,
  OcrProviderCapabilities,
  type OcrProviderCapability,
  type OcrSystemProvider,
  type OcrTesseractProvider,
  type SupportedOcrFile
} from '@shared/types/ocr'

export const isBuiltinOcrProviderId = (id: string): id is BuiltinOcrProviderId => {
  return Object.hasOwn(BuiltinOcrProviderIds, id)
}

export const isOcrProviderCapability = (cap: string): cap is OcrProviderCapability => {
  return Object.hasOwn(OcrProviderCapabilities, cap)
}

export const isOcrProviderApiConfig = (config: unknown): config is OcrProviderApiConfig => {
  return (
    typeof config === 'object' &&
    config !== null &&
    'apiKey' in config &&
    typeof config.apiKey === 'string' &&
    'apiHost' in config &&
    typeof config.apiHost === 'string' &&
    (!('apiVersion' in config) || typeof config.apiVersion === 'string')
  )
}

export const isOcrApiProvider = (p: OcrProvider): p is OcrApiProvider => {
  return !!(p.config && p.config.api && isOcrProviderApiConfig(p.config.api))
}

export const isBuiltinOcrProvider = (p: OcrProvider): p is BuiltinOcrProvider => {
  return isBuiltinOcrProviderId(p.id)
}

export const isImageOcrProvider = (p: OcrProvider): p is ImageOcrProvider => {
  return p.capabilities.image === true
}

export const isSupportedOcrFile = (file: FileMetadata): file is SupportedOcrFile => {
  return isImageFileMetadata(file)
}

export const isOcrTesseractProvider = (p: OcrProvider): p is OcrTesseractProvider => {
  return p.id === BuiltinOcrProviderIds.tesseract
}

export const isOcrSystemProvider = (p: OcrProvider): p is OcrSystemProvider => {
  return p.id === BuiltinOcrProviderIds.system
}

export const isOcrPpocrProvider = (p: OcrProvider): p is OcrPpocrProvider => {
  return p.id === BuiltinOcrProviderIds.paddleocr
}

export const isOcrOVProvider = (p: OcrProvider): p is OcrOvProvider => {
  return p.id === BuiltinOcrProviderIds.ovocr
}
