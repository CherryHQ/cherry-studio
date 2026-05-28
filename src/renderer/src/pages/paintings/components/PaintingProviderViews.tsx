import type { PaintingData } from '../model/types/paintingData'
import type { ModelOption } from '../model/types/paintingModel'
import type { PaintingProviderRuntime } from '../model/types/paintingProviderRuntime'
import Artboard from './Artboard'

/**
 * Placeholder for provider-specific painting UI. After the unified-schema
 * cleanup every provider renders via the generic form pipeline — no vendor-
 * specific settings panels remain. Kept as a stub so the caller's API
 * doesn't churn; future per-provider extras (if any) wire in here.
 */
export function PaintingSettingsExtras(_props: {
  provider: PaintingProviderRuntime
  painting: PaintingData
  modelOptions: ModelOption[]
  selectedModelOption?: ModelOption
  isLoading: boolean
  patchPainting: (updates: Partial<PaintingData>) => void
  tab: string
}) {
  return null
}

export function PaintingArtboard({
  painting,
  isLoading,
  onCancel
}: {
  painting: PaintingData
  isLoading: boolean
  onCancel: () => void
}) {
  return <Artboard painting={painting} isLoading={isLoading} onCancel={onCancel} />
}
