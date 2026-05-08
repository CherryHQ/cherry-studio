import type { GenerateImagesConfig } from '@google/genai'
import type { FileMetadata } from '@renderer/types'
import type { PaintingMediaType, PaintingMode } from '@shared/data/types/painting'

export type PaintingGenerationStatus = 'running' | 'failed' | 'canceled'

export interface PaintingDataBase {
  id: string
  providerId: string
  mode: PaintingMode
  mediaType?: PaintingMediaType
  model?: string
  prompt: string
  files: FileMetadata[]
  inputFiles?: FileMetadata[]
  persistedAt?: string
  generationStatus?: PaintingGenerationStatus | null
  generationTaskId?: string | null
  generationError?: string | null
  generationProgress?: number | null
}

export interface SiliconPaintingData extends PaintingDataBase {
  providerId: 'silicon'
  negativePrompt?: string
  imageSize?: string
  numImages?: number
  seed?: string
  steps?: number
  guidanceScale?: number
  promptEnhancement?: boolean
}

export interface OvmsPaintingData extends PaintingDataBase {
  providerId: 'ovms'
  size?: string
  num_inference_steps?: number
  rng_seed?: number
  safety_check?: boolean
  response_format?: 'url' | 'b64_json'
}

export enum generationModeType {
  GENERATION = 'generation',
  EDIT = 'edit',
  MERGE = 'merge'
}

export interface DmxapiPaintingData extends PaintingDataBase {
  providerId: 'dmxapi'
  n?: number
  aspect_ratio?: string
  image_size?: string
  seed?: string
  style_type?: string
  autoCreate?: boolean
  generationMode?: generationModeType
  priceModel?: string
  extend_params?: Record<string, unknown>
}

export interface TokenFluxPaintingData extends PaintingDataBase {
  providerId: 'tokenflux'
  inputParams?: Record<string, unknown>
}

export interface PpioPaintingData extends PaintingDataBase {
  providerId: 'ppio'
  size?: string
  width?: number
  height?: number
  ppioSeed?: number
  usePreLlm?: boolean
  addWatermark?: boolean
  imageFile?: string
  ppioMask?: string
  resolution?: string
  outputFormat?: string
}

export interface ZhipuPaintingData extends PaintingDataBase {
  providerId: 'zhipu'
  negativePrompt?: string
  imageSize?: string
  numImages?: number
  seed?: string
  quality?: string
}

export interface GeneratePaintingFields {
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
  imageSize?: string
  imageFile?: string
  mask?: FileMetadata
  imageWeight?: number
  resemblance?: number
  detail?: number
}

export interface AihubmixPaintingData extends PaintingDataBase, GeneratePaintingFields {
  providerId: 'aihubmix'
}

export interface OpenApiCompatiblePaintingData extends PaintingDataBase, GeneratePaintingFields {
  providerId: string
}

export type PaintingData =
  | SiliconPaintingData
  | OvmsPaintingData
  | DmxapiPaintingData
  | TokenFluxPaintingData
  | PpioPaintingData
  | ZhipuPaintingData
  | AihubmixPaintingData
  | OpenApiCompatiblePaintingData
