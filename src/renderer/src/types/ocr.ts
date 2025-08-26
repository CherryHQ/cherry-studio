import Tesseract from 'tesseract.js'

import { FileMetadata, ImageFileMetadata, isImageFile } from '.'

export const BuiltinOcrProviderIds = {
  tesseract: 'tesseract'
} as const

export type BuiltinOcrProviderId = keyof typeof BuiltinOcrProviderIds

export const isBuiltinOcrProviderId = (id: string): id is BuiltinOcrProviderId => {
  return Object.hasOwn(BuiltinOcrProviderIds, id)
}

// extensible
export const OcrProviderCapabilities = {
  image: 'image'
} as const

export type OcrProviderCapability = keyof typeof OcrProviderCapabilities

export const isOcrProviderCapability = (cap: string): cap is OcrProviderCapability => {
  return Object.hasOwn(OcrProviderCapabilities, cap)
}

export type OcrProviderCapabilityRecord = Partial<Record<OcrProviderCapability, boolean>>

// OCR models and providers share the same type definition.
// A provider can offer capabilities to process multiple file types,
// while a model belonging to that provider may be limited to processing only one specific file type.
export type OcrModelCapabilityRecord = OcrProviderCapabilityRecord

export interface OcrModel {
  id: string
  name: string
  providerId: string
  capabilities: OcrModelCapabilityRecord
}

/**
 * Extend this type to define provider-specefic config types.
 */
export type OcrProviderApiConfig = {
  apiKey: string
  apiHost: string
  apiVersion?: string
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

/**
 * For future. Model based ocr, api based ocr. May different api client.
 *
 * Extend this type to define provider-specific config types.
 */
export type OcrProviderConfig = {
  /** Not used for now. Could safely remove. */
  api?: OcrProviderApiConfig
  /** Not used for now. Could safely remove. */
  models?: OcrModel[]
  /** Not used for now. Could safely remove. */
  enabled?: boolean
}

export type OcrProvider = {
  id: string
  name: string
  capabilities: OcrProviderCapabilityRecord
  config?: OcrProviderConfig
}

export type OcrApiProvider = OcrProvider & {
  config: OcrProviderConfig & {
    api: OcrProviderApiConfig
  }
}

export const isOcrApiProvider = (p: OcrProvider): p is OcrApiProvider => {
  return !!(p.config && p.config.api && isOcrProviderApiConfig(p.config.api))
}

export type BuiltinOcrProvider = OcrProvider & {
  id: BuiltinOcrProviderId
}

export const isBuiltinOcrProvider = (p: OcrProvider): p is BuiltinOcrProvider => {
  return isBuiltinOcrProviderId(p.id)
}

// Not sure compatiable api endpoint exists. May not support custom ocr provider
export type CustomOcrProvider = OcrProvider & {
  id: Exclude<string, BuiltinOcrProviderId>
}

export type ImageOcrProvider = OcrProvider & {
  capabilities: OcrProviderCapabilityRecord & {
    [OcrProviderCapabilities.image]: true
  }
}

export const isImageOcrProvider = (p: OcrProvider): p is ImageOcrProvider => {
  return p.capabilities.image === true
}

export type SupportedOcrFile = ImageFileMetadata

export const isSupportedOcrFile = (file: FileMetadata): file is SupportedOcrFile => {
  return isImageFile(file)
}

export type OcrResult = {
  text: string
}

export type OcrHandler = (file: SupportedOcrFile) => Promise<OcrResult>

export type OcrImageHandler = (file: ImageFileMetadata) => Promise<OcrResult>

// Tesseract Types
export type OcrTesseractConfig = OcrProviderConfig & {
  langs: Partial<Record<TesseractLangCode, boolean>>
}

export type OcrTesseractProvider = BuiltinOcrProvider & {
  config: OcrTesseractConfig
}

export const isOcrTesseractProvider = (p: OcrProvider): p is OcrTesseractProvider => {
  return p.id === BuiltinOcrProviderIds.tesseract
}

export type TesseractLangCode = Tesseract.LanguageCode
