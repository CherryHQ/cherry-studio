import type { ChartModel } from '../renderModel'

/**
 * Chart rendering adapter.
 * Swappability boundary: no types or concepts from a concrete chart library may leak out of implementation files.
 */
export interface ChartRenderer {
  /** Mounts and renders, returning a disposer. Implementations handle container size changes internally. */
  render(chart: ChartModel, container: HTMLElement): () => void
}
