import type { GenerateImagesConfig } from '@google/genai'

import type { FileMetadata } from './file'

export type PaintingParams = {
  id: string
  urls: string[]
  files: FileMetadata[]
}
export type PaintingProvider = 'zhipu' | 'aihubmix' | 'silicon' | 'dmxapi' | 'new-api'
export type Painting = PaintingParams & {
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
export type GeneratePainting = PaintingParams & {
  model: string
  prompt: string
  aspectRatio?: string
  numImages?: number
  styleType?: string
  seed?: string
  negativePrompt?: string
  magicPromptOption?: boolean
  renderingSpeed?: string
  quality?: string
  moderation?: string
  n?: number
  size?: string
  background?: string
  personGeneration?: GenerateImagesConfig['personGeneration']
  numberOfImages?: number
  safetyTolerance?: number
  width?: number
  height?: number
}
export type EditPainting = PaintingParams & {
  imageFile: string
  mask: FileMetadata
  model: string
  prompt: string
  numImages?: number
  styleType?: string
  seed?: string
  magicPromptOption?: boolean
  renderingSpeed?: string
}
export type RemixPainting = PaintingParams & {
  imageFile: string
  model: string
  prompt: string
  aspectRatio?: string
  imageWeight: number
  numImages?: number
  styleType?: string
  seed?: string
  negativePrompt?: string
  magicPromptOption?: boolean
  renderingSpeed?: string
}
export type ScalePainting = PaintingParams & {
  imageFile: string
  prompt: string
  resemblance?: number
  detail?: number
  numImages?: number
  seed?: string
  magicPromptOption?: boolean
  renderingSpeed?: string
}
export type DmxapiPainting = PaintingParams & {
  model?: string
  prompt?: string
  n?: number
  aspect_ratio?: string
  image_size?: string
  seed?: string
  style_type?: string
  autoCreate?: boolean
  generationMode?: generationModeType
  priceModel?: string
}
export type TokenFluxPainting = PaintingParams & {
  generationId?: string
  model?: string
  prompt?: string
  inputParams?: Record<string, any>
  status?: 'starting' | 'processing' | 'succeeded' | 'failed' | 'cancelled'
}
export type PaintingAction = Partial<
  GeneratePainting & RemixPainting & EditPainting & ScalePainting & DmxapiPainting & TokenFluxPainting
> &
  PaintingParams
export type PaintingsState = {
  // SiliconFlow
  siliconflow_paintings: Painting[]
  // DMXAPI
  dmxapi_paintings: DmxapiPainting[]
  // TokenFlux
  tokenflux_paintings: TokenFluxPainting[]
  // Zhipu
  zhipu_paintings: Painting[]
  // Aihubmix
  aihubmix_image_generate: Partial<GeneratePainting> & PaintingParams[]
  aihubmix_image_remix: Partial<RemixPainting> & PaintingParams[]
  aihubmix_image_edit: Partial<EditPainting> & PaintingParams[]
  aihubmix_image_upscale: Partial<ScalePainting> & PaintingParams[]
  // OpenAI
  openai_image_generate: Partial<GeneratePainting> & PaintingParams[]
  openai_image_edit: Partial<EditPainting> & PaintingParams[]
}
export enum generationModeType {
  GENERATION = 'generation',
  EDIT = 'edit',
  MERGE = 'merge'
}
