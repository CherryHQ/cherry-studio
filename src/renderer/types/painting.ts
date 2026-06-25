import type { FileMetadata } from './file'

export type PaintingParams = {
  id: string
  urls: string[]
  files: FileMetadata[]
  // provider that this painting belongs to (for new-api family separation)
  providerId?: string
}

export interface Painting extends PaintingParams {
  model?: string
  prompt?: string
  negativePrompt?: string
  imageSize?: string
  numImages?: number
  seed?: string
  steps?: number
  guidanceScale?: number
  promptEnhancement?: boolean
}
