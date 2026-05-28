/**
 * Painting provider type system + the only factory consumers use.
 *
 * After the unified-schema rewrite every painting provider is a single-tab
 * generic shape built by `buildPaintingProvider(providerId)` — no per-vendor
 * code paths. The interface stays because consumers (PaintingSettings,
 * usePaintingModelCatalog, ...) memoize on a `PaintingProviderDefinition`
 * reference.
 */

import type { FileMetadata } from '@renderer/types'
import type { PaintingMode } from '@shared/data/types/painting'

import type { PaintingData } from '../model/types/paintingData'
import type { ModelConfig, ModelOption } from '../model/types/paintingModel'
import type { PaintingProviderRuntime } from '../model/types/paintingProviderRuntime'

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

export type ProviderGenerate<T extends PaintingData = PaintingData> = (
  input: GenerateInput<T>
) => Promise<FileMetadata[]>

export interface PaintingProvider<T extends PaintingData = PaintingData> {
  id: string
  mode: ProviderMode<T>
  generate: ProviderGenerate<T>
}

interface SingleModeProviderConfig<T extends PaintingData = PaintingData> {
  id: string
  dbMode: PaintingMode
  models: ModelConfig
  createPaintingData: (input: { modelOptions?: ModelOption[] }) => T
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
    generate: config.generate
  }
}

export type PaintingProviderDefinition = PaintingProvider<any>
