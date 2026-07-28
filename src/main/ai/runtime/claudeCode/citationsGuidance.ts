/**
 * Inline-citation guidance for agent sessions, appended to the system prompt
 * only for the lookup tools the agent can actually call (web unless the user
 * disabled both cherry-tools web lookups; kb only when the agent has bound
 * knowledge bases). Mirrors the assistant-path `CITATIONS_SYSTEM_PROMPT`
 * (`../aiSdk/prompts/citations.ts`); the `[cite:id]` markers are resolved by
 * the renderer against the message's own tool results.
 */

import { toCherryBuiltinRuntimeName } from '@main/ai/tools/adapters/claudeCode/cherryBuiltinApproval'
import { KB_SEARCH_TOOL_NAME, WEB_FETCH_TOOL_NAME, WEB_SEARCH_TOOL_NAME } from '@shared/ai/builtinTools'

export const CHERRY_WEB_SEARCH_RUNTIME_NAME = toCherryBuiltinRuntimeName(WEB_SEARCH_TOOL_NAME)
export const CHERRY_WEB_FETCH_RUNTIME_NAME = toCherryBuiltinRuntimeName(WEB_FETCH_TOOL_NAME)
export const CHERRY_KB_SEARCH_RUNTIME_NAME = toCherryBuiltinRuntimeName(KB_SEARCH_TOOL_NAME)

export interface CitationsGuidanceOptions {
  web: boolean
  kb: boolean
}

export function buildCitationsGuidance({ web, kb }: CitationsGuidanceOptions): string | undefined {
  if (!web && !kb) return undefined
  const tools = [
    ...(web ? [`\`${CHERRY_WEB_SEARCH_RUNTIME_NAME}\` / \`${CHERRY_WEB_FETCH_RUNTIME_NAME}\``] : []),
    ...(kb ? [`\`${CHERRY_KB_SEARCH_RUNTIME_NAME}\``] : [])
  ].join(' and ')
  return `## Citations

Results from ${tools} each carry an \`id\` field. When a statement in your reply is based on one of those results, append a citation marker immediately after it: [cite:ID] with the exact id (e.g. "Prices rose 3% in June. [cite:k3f-2]"). Chain markers when several results support one statement: [cite:k3f-1][cite:x9a-3]. Copy ids exactly — never invent or renumber them — and do not add a "References" or "Sources" section: the app renders citations from the inline markers.`
}
