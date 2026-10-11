/**
 * Sibling-branch context.
 *
 * Carries the per-topic `siblingsMap` (from `useTopicMessages`) and the
 * current `activeNodeId` so user-message sibling navigators can render
 * `< i/N >` and switch branches without each consumer plumbing topic-level
 * state through props.
 */

import { createContext } from 'react'

import type { Message as SharedMessage } from '@shared/data/types/message'

export interface SiblingsContextValue {
  /** See `UseTopicMessagesResult.siblingsMap`. */
  siblingsMap: Record<string, SharedMessage[]>
  /** Current topic `activeNodeId`, used to compute which sibling is in view. */
  activeNodeId: string | null
}

export const SiblingsContext = createContext<SiblingsContextValue | null>(null)
export const SiblingsProvider = SiblingsContext.Provider
