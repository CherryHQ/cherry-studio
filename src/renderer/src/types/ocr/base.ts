import type { FileMetadata, ImageFileMetadata, OcrProviderConfig } from '..'
import { isImageFileMetadata } from '..'

export type SupportedOcrFile = ImageFileMetadata

export const isSupportedOcrFile = (file: FileMetadata): file is SupportedOcrFile => {
  return isImageFileMetadata(file)
}

export type OcrParams = {
  providerId: string
}

export type OcrResult = {
  text: string
}

export type OcrHandler = (file: SupportedOcrFile, config?: OcrProviderConfig) => Promise<OcrResult>

export type OcrImageHandler = (file: ImageFileMetadata, config?: OcrProviderConfig) => Promise<OcrResult>
