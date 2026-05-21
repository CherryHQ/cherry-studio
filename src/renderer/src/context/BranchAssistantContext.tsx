import type { Assistant } from '@renderer/types'
import { createContext, use } from 'react'

/**
 * T-006D-2B side-by-side branch — assistant override at the React-subtree boundary.
 *
 * The branch topic is intentionally NOT registered in Redux `state.assistants[].topics[]`
 * (keeps the sidebar clean, see preflight §W4). But the existing per-message
 * actions in `MessageMenubar.tsx` (regenerate / resend / edit / delete /
 * appendAssistantResponse) source their `assistant` via `useAssistant(message.assistantId)`
 * → Redux global lookup → the resolved assistant's `.topics[]` is the main set
 * **without** the branch topic, so `messageThunk:854 origAssistant.topics.find(...)`
 * misses and the system-prompt injection is lost.
 *
 * Fix: BranchPane wraps its subtree in `<BranchAssistantContext.Provider value={{ assistant: synthetic }}>`,
 * where `synthetic = { ...mainAssistant, topics: [...mainAssistant.topics, branchTopic] }`.
 * `useAssistant(id)` checks this Context FIRST and returns the synthetic assistant
 * only when (a) a Provider exists AND (b) the id strictly matches. Otherwise it
 * falls through to the existing Redux path unchanged.
 *
 * Default value is `null` → the entire main chat (no Provider in scope) sees
 * exactly today's behaviour. The Provider has no global side effect; the
 * synthetic assistant is a per-render in-memory object and never enters Redux.
 */
export interface BranchAssistantOverride {
  /** The synthetic assistant whose `.topics` transiently carries the branch topic with prompt set. */
  assistant: Assistant
}

export const BranchAssistantContext = createContext<BranchAssistantOverride | null>(null)

/**
 * Convenience reader for hooks (currently used by `useAssistant`).
 *
 * Returns the override descriptor if a Provider sits above this call site,
 * otherwise `null`. Consumers should pair this with a strict id match before
 * preferring the override — that guarantee lives in `useAssistant`.
 */
export function useBranchAssistantOverride(): BranchAssistantOverride | null {
  return use(BranchAssistantContext)
}

/**
 * Pure decision: which assistant should `useAssistant(id)` source from?
 *
 * Extracted as a pure helper so it can be unit-tested without dragging
 * useAssistant's entire dependency graph (Redux store, model config, default-
 * assistant initialization, ...) into the test. The unit tests here are the
 * sole regression coverage that proves main-chat behaviour is bit-for-bit
 * unaffected when no Provider is in scope, AND that the override is gated
 * by a strict id match.
 *
 * Caller contract (see useAssistant): both arguments are passed in *as
 * returned by their hooks*, so this function makes no React calls.
 */
import type { Assistant as TAssistant } from '@renderer/types'
export function resolveAssistantSource(
  id: string,
  reduxAssistant: TAssistant,
  override: BranchAssistantOverride | null
): TAssistant {
  // Strict-match guardrail: ONLY swap when both
  //   (a) a Provider exists above us (override !== null) AND
  //   (b) the id strictly matches the synthetic assistant's id.
  // Any other call site — main chat (no Provider) or branch-internal lookups
  // for a different assistant id — keeps the Redux source path.
  if (override !== null && override.assistant.id === id) {
    return override.assistant
  }
  return reduxAssistant
}
