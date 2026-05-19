import type { PaintingProviderRuntime } from './paintingProviderRuntime'

export type ModelOption<TRaw = unknown> = {
  label: string
  value: string
  group?: string
  isEnabled?: boolean
  raw?: TRaw
  /** Provider-specific extra data. Keep declared fields strictly typed; put anything else here. */
  meta?: Record<string, unknown>
}

export type ModelConfig =
  | { type: 'static'; options: ModelOption[] }
  | { type: 'async'; loader: (provider?: PaintingProviderRuntime) => Promise<ModelOption[]> }
  | { type: 'dynamic'; resolver: (provider: PaintingProviderRuntime) => ModelOption[] }
