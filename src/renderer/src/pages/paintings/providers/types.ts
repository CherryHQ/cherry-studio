import type { PaintingCanvas } from '@renderer/types'
import type { Provider } from '@renderer/types/provider'
import type { PaintingMode } from '@shared/data/types/painting'
import type { TFunction } from 'i18next'
import type { ReactNode } from 'react'

import type { BaseConfigItem } from '../components/PaintingConfigFieldRenderer'
import type { ModelConfig, ModelOption } from '../hooks/useModelLoader'

export interface GenerateContext<T extends PaintingCanvas = PaintingCanvas> {
  painting: T
  provider: Provider
  abortController: AbortController
  patchPainting: (updates: Partial<T>) => void
  setFallbackUrls: (urls: string[]) => void
  setIsLoading: (v: boolean) => void
  setGenerating: (v: boolean) => void
  t: TFunction
  mode?: string
}

export interface PaintingProviderDefinition<T extends PaintingCanvas = PaintingCanvas> {
  providerId: string

  // Modes (e.g., generate/edit/remix)
  modes?: Array<{ value: string; labelKey: string }>
  defaultMode?: string
  modeToDbMode?: (mode: string) => PaintingMode

  // Model loading
  models: ModelConfig | ((mode: string) => ModelConfig)

  // Config fields per mode (or single array if no modes)
  configFields: BaseConfigItem[] | Record<string, BaseConfigItem[]>

  // Factory for default painting
  getDefaultPainting: (mode?: string, models?: ModelOption[]) => T

  // Generation function - stays fully custom per provider
  onGenerate: (ctx: GenerateContext<T>) => Promise<void>

  // Model change side effects
  onModelChange?: (modelId: string, painting: T, models: ModelOption[]) => Partial<T>

  // Provider header extras (help links, icons)
  providerHeaderExtra?: (provider: Provider, t: TFunction) => ReactNode

  // Artboard overrides
  artboardOverrides?: (painting: T, state: any) => Record<string, any>

  // Custom center content (e.g., TokenFlux split view)
  centerContent?: (state: any) => ReactNode

  // Image upload handling (for config items with type: 'image')
  onImageUpload?: (key: string, file: File, patchPainting: (updates: Partial<T>) => void) => void
  getImagePreviewSrc?: (key: string, painting: T) => string | undefined
  imagePlaceholder?: ReactNode

  // Extra sidebar content after config fields
  sidebarExtra?: (state: any) => ReactNode

  // Prompt bar overrides
  promptPlaceholder?: (painting: T, t: TFunction, isTranslating: boolean) => string
  promptDisabled?: (painting: T, isLoading: boolean) => boolean

  // Whether to show translate button
  showTranslate?: boolean
}
