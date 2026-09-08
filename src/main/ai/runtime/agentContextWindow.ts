/**
 * Runtime-neutral context-window fallback for agent runtimes (pi, dsh), which
 * need a compaction boundary even when Cherry's model row declares none. Model
 * filtering no longer gates on the window, so this stays main-side.
 */

import type { Model } from '@shared/data/types/model'

/** Decimal 256K: a model whose real window is 256K never overflows this boundary. */
export const DEFAULT_AGENT_CONTEXT_WINDOW = 256_000

/** The model's declared context window, or the default when it declares none. */
export function resolveAgentContextWindow(model: Model): number {
  return typeof model.contextWindow === 'number' && Number.isFinite(model.contextWindow) && model.contextWindow > 0
    ? model.contextWindow
    : DEFAULT_AGENT_CONTEXT_WINDOW
}
