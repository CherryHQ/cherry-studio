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
  customWidth?: number
  customHeight?: number
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

/**
 * Catch-all variant for OpenAI-compatible providers (new-api, cherryin, aionly,
 * any provider with `presetProviderId === 'new-api'`, plus arbitrary user-added
 * providers). This set is open-ended and not enumerable, so `providerId` is
 * intentionally the wide `string` type rather than a literal.
 *
 * Consequence: `PaintingData` is intentionally NOT a closed discriminated union.
 * The wide `string` member overlaps every literal member, so a `switch
 * (data.providerId)` cannot exhaustively narrow it. Discriminate via the
 * dedicated user-defined type guards in `PaintingProviderViews.tsx`
 * (`isTokenFluxPainting`, `isOpenApiCompatiblePainting`, ...), which test
 * concrete provider ids and treat this variant as the typed fallback. Do NOT
 * add an exhaustive `switch`/`assertNever` over `PaintingData.providerId`.
 */
export interface OpenApiCompatiblePaintingData extends PaintingDataBase, GeneratePaintingFields {
  providerId: string
}

/**
 * Intentionally non-exhaustive: `OpenApiCompatiblePaintingData` is the open-set
 * fallback (see its docs). Narrow with the type guards in
 * `PaintingProviderViews.tsx`, never with an exhaustive `switch` on `providerId`.
 */
export type PaintingData =
  | SiliconPaintingData
  | OvmsPaintingData
  | DmxapiPaintingData
  | TokenFluxPaintingData
  | PpioPaintingData
  | ZhipuPaintingData
  | AihubmixPaintingData
  | OpenApiCompatiblePaintingData
