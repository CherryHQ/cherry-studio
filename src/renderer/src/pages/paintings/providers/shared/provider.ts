import type { FileMetadata } from '@renderer/types'
import type { PaintingMode } from '@shared/data/types/painting'
import type { ReactNode } from 'react'

import type { PaintingData } from '../../model/types/paintingData'
import type { ModelConfig, ModelOption } from '../../model/types/paintingModel'
import type { PaintingProviderRuntime } from '../../model/types/paintingProviderRuntime'
import type { BaseConfigItem } from './providerFieldSchema'

export interface GenerateInput<T extends PaintingData = PaintingData> {
  painting: T
  provider: PaintingProviderRuntime
  tab: string
  abortController: AbortController
  onGenerationStateChange?: (
    updates: Partial<
      Pick<PaintingData, 'generationTaskId' | 'generationError' | 'generationProgress' | 'generationStatus'>
    >
  ) => void
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
  placeholder?: (input: { painting: T }) => string
  disabled?: (input: { painting: T; isLoading: boolean }) => boolean
}

export interface ProviderImage<T extends PaintingData = PaintingData> {
  onUpload?: (input: {
    key: string
    file: File
    patchPainting: (updates: Partial<PaintingData>) => void
    /** Current painting before the patch — lets handlers revoke the previous field value (e.g. blob URL). */
    painting?: T
  }) => void
  getPreviewSrc?: (input: { key: string; painting: T }) => string | undefined
  placeholder?: ReactNode
}

export type ProviderGenerate<T extends PaintingData = PaintingData> = (
  input: GenerateInput<T>
) => Promise<FileMetadata[]>

export interface PaintingProvider<T extends PaintingData = PaintingData> {
  id: string
  mode: ProviderMode<T>
  fields: ProviderFields<T>
  prompt?: ProviderPrompt<T>
  image?: ProviderImage<T>
  generate: ProviderGenerate<T>
  /**
   * Opt into the registry-derived field set: when true, the painting page
   * reads `ImageGenerationSupport` for the current `(providerId, modelId)` via
   * `useImageGenerationSupport` and renders the derived `BaseConfigItem[]`
   * instead of `fields.byTab[tab]`. Providers must align their canonical
   * field-key contract — or supply `registryKeyMap` to alias canonical keys to
   * legacy persisted names (e.g. silicon: `{ size: 'imageSize' }`).
   */
  useRegistryForm?: boolean
  /** Per-provider canonical→legacy key aliases for the derived form. */
  registryKeyMap?: Record<string, string>
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
  generate: ProviderGenerate<T>
  useRegistryForm?: boolean
  registryKeyMap?: Record<string, string>
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
    generate: config.generate,
    useRegistryForm: config.useRegistryForm,
    registryKeyMap: config.registryKeyMap
  }
}

export type PaintingProviderDefinition = PaintingProvider<any>
