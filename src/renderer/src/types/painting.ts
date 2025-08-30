import type { GenerateImagesConfig } from '@google/genai'

import type { FileMetadata } from './file'

export type PaintingParams = {
  id: string
  urls: string[]
  files: FileMetadata[]
}
export type PaintingProvider = 'aihubmix' | 'silicon' | 'dmxapi' | 'new-api'
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
export interface GeneratePainting extends PaintingParams {
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
export interface EditPainting extends PaintingParams {
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
export interface RemixPainting extends PaintingParams {
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
export interface ScalePainting extends PaintingParams {
  imageFile: string
  prompt: string
  resemblance?: number
  detail?: number
  numImages?: number
  seed?: string
  magicPromptOption?: boolean
  renderingSpeed?: string
}
export interface DmxapiPainting extends PaintingParams {
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
export interface TokenFluxPainting extends PaintingParams {
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
export interface PaintingsState {
  paintings: Painting[]
  generate: Partial<GeneratePainting> & PaintingParams[]
  remix: Partial<RemixPainting> & PaintingParams[]
  edit: Partial<EditPainting> & PaintingParams[]
  upscale: Partial<ScalePainting> & PaintingParams[]
  DMXAPIPaintings: DmxapiPainting[]
  tokenFluxPaintings: TokenFluxPainting[]
  openai_image_generate: Partial<GeneratePainting> & PaintingParams[]
  openai_image_edit: Partial<EditPainting> & PaintingParams[]
}
export enum generationModeType {
  GENERATION = 'generation',
  EDIT = 'edit',
  MERGE = 'merge'
}
