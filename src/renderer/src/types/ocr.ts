import type Tesseract from 'tesseract.js'

import type { ImageFileMetadata, TranslateLanguageCode } from '.'

export type BuiltinOcrProviderId = 'tesseract' | 'system' | 'paddleocr' | 'ovocr'

export type OcrProviderCapability = 'image'

export type OcrProviderCapabilityRecord = Partial<Record<OcrProviderCapability, boolean>>

export type OcrProvider = {
  id: string
  name: string
  capabilities: OcrProviderCapabilityRecord
  config?: OcrProviderBaseConfig
}

export type BuiltinOcrProvider = OcrProvider & {
  id: BuiltinOcrProviderId
}

type ImageOcrProvider = OcrProvider & {
  capabilities: OcrProviderCapabilityRecord & {
    image: true
  }
}

export type SupportedOcrFile = ImageFileMetadata

export type TesseractLangCode = Tesseract.LanguageCode

// Tesseract Types
type OcrProviderBaseConfig = {
  enabled?: boolean
}

type OcrTesseractConfig = OcrProviderBaseConfig & {
  langs?: Partial<Record<TesseractLangCode, boolean>>
}

export type OcrTesseractProvider = {
  id: 'tesseract'
  config: OcrTesseractConfig
} & ImageOcrProvider &
  BuiltinOcrProvider

// System Types
type OcrSystemConfig = OcrProviderBaseConfig & {
  langs?: TranslateLanguageCode[]
}

export type OcrSystemProvider = {
  id: 'system'
  config: OcrSystemConfig
} & ImageOcrProvider &
  BuiltinOcrProvider

// PaddleOCR Types
type OcrPpocrConfig = OcrProviderBaseConfig & {
  apiUrl?: string
  accessToken?: string
}

export type OcrPpocrProvider = {
  id: 'paddleocr'
  config: OcrPpocrConfig
} & ImageOcrProvider &
  BuiltinOcrProvider

// OV OCR Types
type OcrOvConfig = OcrProviderBaseConfig & {
  langs?: TranslateLanguageCode[]
}

export type OcrOvProvider = {
  id: 'ovocr'
  config: OcrOvConfig
} & ImageOcrProvider &
  BuiltinOcrProvider
