import type { ModelThinkingLevel } from '@earendil-works/pi-ai'

import type { ReasoningEffortOption } from '@shared/types/aiSdk'

/**
 * @param selection - The effective reasoning selection for this connection.
 * @returns The Pi level, or undefined to preserve Pi's default and resume behavior.
 */
export function resolvePiThinkingLevel(selection?: ReasoningEffortOption): ModelThinkingLevel | undefined {
  if (selection === undefined || selection === 'default' || selection === 'auto') return undefined
  return selection === 'none' ? 'off' : selection
}
