import type { CherryMessagePart } from '../data/types/message'

/**
 * Part types that never render as visible content in an agent-session turn.
 * Single source of truth for the terminal "no response" fallback: main judges
 * turn visibility at persistence time and the renderer judges it at display
 * time, so both must agree on what counts as visible.
 */
export const AGENT_SESSION_HIDDEN_PART_TYPES: ReadonlySet<string> = new Set([
  'step-start',
  'source-url',
  'source-document',
  'data-citation',
  'data-agent-task-event',
  'data-knowledge-scope',
  'data-clear'
])

/** True when a part can render as visible turn content. */
export function isVisibleAgentSessionPart(part: CherryMessagePart): boolean {
  if (AGENT_SESSION_HIDDEN_PART_TYPES.has(part.type)) return false
  // Retry history is visible process context, not an assistant answer.
  if (part.type === 'data-agent-api-retry') return false
  if (part.type === 'text') return !!part.text?.trim()
  // A reasoning part still streaming holds no text yet but is not terminal-empty.
  if (part.type === 'reasoning') return part.state === 'streaming' || !!part.text?.trim()
  return true
}

/** True when at least one part renders as visible turn content. */
export function hasVisibleAgentSessionPart(parts: readonly CherryMessagePart[] | undefined): boolean {
  return (parts ?? []).some(isVisibleAgentSessionPart)
}

/** Why a synthetic no-response error was authored on a terminal assistant turn. */
export type NoResponseErrorReason = 'terminal-error' | 'crash-orphan-reconcile' | 'empty-success-terminal'

export interface NoResponseErrorPartOptions {
  /** English fallback text; the renderer prefers `error.<i18nKey>` when present. */
  message: string
  /** Catalog key rendered by the error block as `error.<i18nKey>`. */
  i18nKey?: string
  reason?: NoResponseErrorReason
}

/** Synthetic `data-error` part for an assistant turn that terminated without usable content. */
export function createNoResponseErrorPart(options: NoResponseErrorPartOptions): CherryMessagePart {
  return {
    type: 'data-error',
    data: {
      name: 'AgentRuntimeError',
      message: options.message,
      stack: null,
      ...(options.i18nKey ? { i18nKey: options.i18nKey } : {}),
      ...(options.reason ? { reason: options.reason } : {})
    }
  }
}

/** Returns `data` with a no-response `data-error` part appended, unless one already exists. */
export function appendNoResponseErrorPart<T extends { parts?: CherryMessagePart[] }>(
  data: T,
  options: NoResponseErrorPartOptions
): T {
  const parts = data.parts ?? []
  if (parts.some((part) => part.type === 'data-error')) return data
  return { ...data, parts: [...parts, createNoResponseErrorPart(options)] }
}
