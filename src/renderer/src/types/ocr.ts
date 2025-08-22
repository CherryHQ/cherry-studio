import { FileMetadata, ImageFileMetadata, isImageFile, Model } from '.'

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

export type OcrProviderCapabilityRecord = Record<OcrProviderCapability, boolean>

export type OcrProvider = {
  id: string
  name: string
  capabilities: OcrProviderCapabilityRecord
  config?: {
    // for future. Model based ocr, api based ocr. May different api client.
    api?: {
      apiKey: string
      apiHost: string
      apiVersion?: string
    }
    models?: Model[]
    enabled?: boolean
  }
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
  return p.capabilities.image
}

export type SupportedOcrFile = ImageFileMetadata

export const isSupportedOcrFile = (file: FileMetadata): file is SupportedOcrFile => {
  return isImageFile(file)
}

export type OcrResult = {
  text: string
}
