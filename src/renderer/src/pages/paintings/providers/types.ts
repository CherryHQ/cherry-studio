/**
 * Painting provider type system + the only factory consumers use.
 *
 * After the unified-schema rewrite every painting provider is a generic
 * single-mode shape built by `buildPaintingProvider(providerId)` — no
 * per-vendor code paths. The interface stays so consumers
 * (`usePaintingModelSwitch`, `usePaintingList`, ...) memoize on a stable
 * `PaintingProviderDefinition` reference.
 */

import type { FileMetadata } from '@renderer/types'

import type { PaintingData } from '../model/types/paintingData'
import type { ModelOption } from '../model/types/paintingModel'
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

export type ProviderGenerate<T extends PaintingData = PaintingData> = (
  input: GenerateInput<T>
) => Promise<FileMetadata[]>

export interface PaintingProvider<T extends PaintingData = PaintingData> {
  id: string
  createPaintingData: (input: { modelOptions?: ModelOption[] }) => T
  generate: ProviderGenerate<T>
}

interface SingleModeProviderConfig<T extends PaintingData = PaintingData> {
  id: string
  createPaintingData: (input: { modelOptions?: ModelOption[] }) => T
  generate: ProviderGenerate<T>
}

export function createSingleModeProvider<T extends PaintingData = PaintingData>(
  config: SingleModeProviderConfig<T>
): PaintingProvider<T> {
  return {
    id: config.id,
    createPaintingData: config.createPaintingData,
    generate: config.generate
  }
}

export type PaintingProviderDefinition = PaintingProvider<any>
