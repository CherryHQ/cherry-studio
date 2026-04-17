import type { Provider } from '@renderer/types/provider'
import type { PaintingMode } from '@shared/data/types/painting'
import type { TFunction } from 'i18next'
import type { ReactNode } from 'react'

import type { ModelConfig, ModelOption } from '../../hooks/useModelLoader'
import type { PaintingData } from '../../model/types/paintingData'
import type { BaseConfigItem } from './providerFieldSchema'

export interface GenerateWriters<T extends PaintingData = PaintingData> {
  patchPainting: (updates: Partial<T>) => void
  setFallbackUrls: (urls: string[]) => void
  setIsLoading: (value: boolean) => void
}

export interface GenerateContext<T extends PaintingData = PaintingData> {
  input: {
    painting: T
    provider: Provider
    tab: string
    abortController: AbortController
  }
  writers: GenerateWriters<T>
}

export interface SidebarSlotState<T extends PaintingData = PaintingData> {
  tab: string
  painting: T
  modelOptions: ModelOption[]
  isLoading: boolean
  patchPainting: (updates: Partial<T>) => void
  t: TFunction
}

export interface CenterSlotState<T extends PaintingData = PaintingData> {
  tab: string
  painting: T
  modelOptions: ModelOption[]
  isLoading: boolean
  currentImageIndex: number
  prevImage: () => void
  nextImage: () => void
  onCancel: () => void
  t: TFunction
}

export interface ArtboardSlotState<T extends PaintingData = PaintingData> {
  tab: string
  painting: T
  modelOptions: ModelOption[]
}

export interface ProviderMode<T extends PaintingData = PaintingData> {
  tabs: Array<{ value: string; labelKey: string }>
  defaultTab: string
  tabToDbMode: (tab: string) => PaintingMode
  getModels: (tab: string) => ModelConfig
  createPaintingData: (input: { tab: string; modelOptions?: ModelOption[] }) => T
}

export interface ProviderFields<T extends PaintingData = PaintingData> {
  byTab: Record<string, BaseConfigItem[]>
  onModelChange?: (input: { modelId: string; painting: T; modelOptions: ModelOption[] }) => Partial<T>
}

export interface ProviderPrompt<T extends PaintingData = PaintingData> {
  translateShortcut?: boolean
  placeholder?: (input: { painting: T; t: TFunction; isTranslating: boolean }) => string
  disabled?: (input: { painting: T; isLoading: boolean }) => boolean
}

export interface ProviderImage<T extends PaintingData = PaintingData> {
  onUpload?: (input: { key: string; file: File; patchPainting: (updates: Partial<T>) => void }) => void
  getPreviewSrc?: (input: { key: string; painting: T }) => string | undefined
  placeholder?: ReactNode
}

export interface ProviderSlots<T extends PaintingData = PaintingData> {
  headerExtra?: (provider: Provider, t: TFunction) => ReactNode
  sidebarExtra?: (state: SidebarSlotState<T>) => ReactNode
  centerContent?: (state: CenterSlotState<T>) => ReactNode
  artboardOverrides?: (state: ArtboardSlotState<T>) => Record<string, unknown>
}

export type ProviderGenerate<T extends PaintingData = PaintingData> = (ctx: GenerateContext<T>) => Promise<void>

export interface PaintingProvider<T extends PaintingData = PaintingData> {
  id: string
  mode: ProviderMode<T>
  fields: ProviderFields<T>
  prompt?: ProviderPrompt<T>
  image?: ProviderImage<T>
  slots?: ProviderSlots<T>
  generate: ProviderGenerate<T>
}

interface SingleModeProviderConfig<T extends PaintingData = PaintingData> {
  id: string
  dbMode: PaintingMode
  models: ModelConfig
  createPaintingData: (input: { modelOptions?: ModelOption[] }) => T
  fields: BaseConfigItem[]
  onModelChange?: (input: { modelId: string; painting: T; modelOptions: ModelOption[] }) => Partial<T>
  prompt?: ProviderPrompt<T>
  image?: ProviderImage<T>
  slots?: ProviderSlots<T>
  generate: ProviderGenerate<T>
}

export function createSingleModeProvider<T extends PaintingData = PaintingData>(
  config: SingleModeProviderConfig<T>
): PaintingProvider<T> {
  return {
    id: config.id,
    mode: {
      tabs: [{ value: 'default', labelKey: 'paintings.mode.generate' }],
      defaultTab: 'default',
      tabToDbMode: () => config.dbMode,
      getModels: () => config.models,
      createPaintingData: ({ modelOptions }) => config.createPaintingData({ modelOptions })
    },
    fields: {
      byTab: {
        default: config.fields
      },
      onModelChange: config.onModelChange
    },
    prompt: config.prompt,
    image: config.image,
    slots: config.slots,
    generate: config.generate
  }
}

export function createMultiModeProvider<T extends PaintingData = PaintingData>(provider: PaintingProvider<T>) {
  return provider
}

export type PaintingProviderDefinition<T extends PaintingData = PaintingData> = PaintingProvider<T>
