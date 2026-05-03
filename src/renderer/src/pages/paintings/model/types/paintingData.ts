import type { GenerateImagesConfig } from '@google/genai'
import type { FileMetadata } from '@renderer/types'

export interface PaintingDataBase {
  id: string
  files: FileMetadata[]
  providerId?: string
  runtimeProviderId?: string
}

export interface SiliconPaintingData extends PaintingDataBase {
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

export interface GeneratePaintingData extends PaintingDataBase {
  model?: string
  prompt?: string
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
}

export interface EditPaintingData extends PaintingDataBase {
  imageFile?: string
  mask?: FileMetadata
  model?: string
  prompt?: string
  numImages?: number
  styleType?: string
  seed?: string
  magicPromptOption?: boolean
  renderingSpeed?: string
}

export interface RemixPaintingData extends PaintingDataBase {
  imageFile?: string
  model?: string
  prompt?: string
  aspectRatio?: string
  imageWeight?: number
  numImages?: number
  styleType?: string
  seed?: string
  negativePrompt?: string
  magicPromptOption?: boolean
  renderingSpeed?: string
}

export interface ScalePaintingData extends PaintingDataBase {
  imageFile?: string
  prompt?: string
  resemblance?: number
  detail?: number
  numImages?: number
  seed?: string
  magicPromptOption?: boolean
  renderingSpeed?: string
}

export enum generationModeType {
  GENERATION = 'generation',
  EDIT = 'edit',
  MERGE = 'merge'
}

export interface DmxapiPaintingData extends PaintingDataBase {
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
  extend_params?: Record<string, unknown>
}

export type TokenFluxGenerationStatus = 'starting' | 'processing' | 'succeeded' | 'failed' | 'cancelled'

export interface TokenFluxPaintingData extends PaintingDataBase {
  generationId?: string
  model?: string
  prompt?: string
  inputParams?: Record<string, unknown>
  generationStatus?: TokenFluxGenerationStatus
}

export interface OvmsPaintingData extends PaintingDataBase {
  model?: string
  prompt?: string
  size?: string
  num_inference_steps?: number
  rng_seed?: number
  safety_check?: boolean
  response_format?: 'url' | 'b64_json'
}

export type PpioTaskStatus = 'pending' | 'processing' | 'succeeded' | 'failed' | 'cancelled'

export interface PpioPaintingData extends PaintingDataBase {
  model?: string
  prompt?: string
  size?: string
  width?: number
  height?: number
  ppioSeed?: number
  usePreLlm?: boolean
  addWatermark?: boolean
  taskId?: string
  taskStatus?: PpioTaskStatus
  imageFile?: string
  ppioMask?: string
  resolution?: string
  outputFormat?: string
}

export type PaintingData = PaintingDataBase &
  Partial<
    SiliconPaintingData &
      GeneratePaintingData &
      EditPaintingData &
      RemixPaintingData &
      ScalePaintingData &
      DmxapiPaintingData &
      TokenFluxPaintingData &
      OvmsPaintingData &
      PpioPaintingData
  >
