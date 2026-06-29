import type { TranslateLangCode } from '@shared/data/preference/preferenceTypes'
import type { ImageFileMetadata } from '@shared/data/types/file/legacyFileMetadata'
import type Tesseract from 'tesseract.js'

export const BuiltinOcrProviderIds = {
  tesseract: 'tesseract',
  system: 'system',
  paddleocr: 'paddleocr',
  ovocr: 'ovocr'
} as const

export type BuiltinOcrProviderId = keyof typeof BuiltinOcrProviderIds

// extensible
export const OcrProviderCapabilities = {
  image: 'image'
  // pdf: 'pdf'
} as const

export type OcrProviderCapability = keyof typeof OcrProviderCapabilities

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

/**
 * For future. Model based ocr, api based ocr. May different api client.
 *
 * Extend this type to define provider-specific config types.
 */
export type OcrProviderBaseConfig = {
  /** Not used for now. Could safely remove. */
  api?: OcrProviderApiConfig
  /** Not used for now. Could safely remove. */
  models?: OcrModel[]
  /** Not used for now. Could safely remove. */
  enabled?: boolean
}

export type OcrProviderConfig = OcrApiProviderConfig | OcrTesseractConfig | OcrSystemConfig | OcrPpocrConfig

export type OcrProvider = {
  id: string
  name: string
  capabilities: OcrProviderCapabilityRecord
  config?: OcrProviderBaseConfig
}

export type OcrApiProviderConfig = OcrProviderBaseConfig & {
  api: OcrProviderApiConfig
}

export type OcrApiProvider = OcrProvider & {
  config: OcrApiProviderConfig
}

export type BuiltinOcrProvider = OcrProvider & {
  id: BuiltinOcrProviderId
}

// Not sure compatible api endpoint exists. May not support custom ocr provider
export type CustomOcrProvider = OcrProvider & {
  id: Exclude<string, BuiltinOcrProviderId>
}

export type ImageOcrProvider = OcrProvider & {
  capabilities: OcrProviderCapabilityRecord & {
    [OcrProviderCapabilities.image]: true
  }
}

// export type PdfOcrProvider = OcrProvider & {
//   capabilities: OcrProviderCapabilityRecord & {
//     [OcrProviderCapabilities.pdf]: true
//   }
// }

export type SupportedOcrFile = ImageFileMetadata

export type OcrResult = {
  text: string
}

export type OcrHandler = (file: SupportedOcrFile, options?: OcrProviderBaseConfig) => Promise<OcrResult>

export type OcrImageHandler = (file: ImageFileMetadata, options?: OcrProviderBaseConfig) => Promise<OcrResult>

// Tesseract Types
export type OcrTesseractConfig = OcrProviderBaseConfig & {
  langs?: Partial<Record<TesseractLangCode, boolean>>
}

export type OcrTesseractProvider = {
  id: 'tesseract'
  config: OcrTesseractConfig
} & ImageOcrProvider &
  BuiltinOcrProvider

export type TesseractLangCode = Tesseract.LanguageCode

// System Types
export type OcrSystemConfig = OcrProviderBaseConfig & {
  langs?: TranslateLangCode[]
}

export type OcrSystemProvider = {
  id: 'system'
  config: OcrSystemConfig
} & ImageOcrProvider &
  // PdfOcrProvider &
  BuiltinOcrProvider

// PaddleOCR Types
export type OcrPpocrConfig = OcrProviderBaseConfig & {
  apiUrl?: string
  accessToken?: string
}

export type OcrPpocrProvider = {
  id: 'paddleocr'
  config: OcrPpocrConfig
} & ImageOcrProvider &
  // PdfOcrProvider &
  BuiltinOcrProvider

// OV OCR Types
export type OcrOvConfig = OcrProviderBaseConfig & {
  langs?: TranslateLangCode[]
}

export type OcrOvProvider = {
  id: 'ovocr'
  config: OcrOvConfig
} & ImageOcrProvider &
  // PdfOcrProvider &
  BuiltinOcrProvider
