import type { PaintingData } from './paintingData'
import type { PaintingProviderRuntime } from './paintingProviderRuntime'

/**
 * Argument shape for `paintingGenerate`. Carries the painting state, the
 * runtime provider (apiKey / apiHost / isEnabled — see
 * `usePaintingProviderRuntime`), and the abort controller for cancellation.
 *
 * `tab` is a vestigial single-value 'default' kept for backward-compat with
 * any consumer that still expects it on the input.
 */
export interface GenerateInput<T extends PaintingData = PaintingData> {
  painting: T
  provider: PaintingProviderRuntime
  tab: string
  abortController: AbortController
}
