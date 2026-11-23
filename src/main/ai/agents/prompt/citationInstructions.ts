/**
 * Runtime-neutral inline-citation guidance for agent sessions, appended to the system prompt
 * only for the lookup tools the agent can actually call (web unless the user
 * disabled both cherry-tools web lookups; kb only when the resolved knowledge
 * scope is non-empty — a static binding or a per-turn composer selection).
 * Mirrors the assistant-path `CITATIONS_SYSTEM_PROMPT`
 * (`../aiSdk/prompts/citations.ts`); the `[cite:id]` markers are resolved by
 * the renderer against the tool results of the message and earlier turns.
 */

import {
  KB_READ_TOOL_NAME,
  KB_SEARCH_TOOL_NAME,
  WEB_FETCH_TOOL_NAME,
  WEB_SEARCH_TOOL_NAME
} from '@shared/ai/builtinTools'

import type { BuildAgentPromptOptions } from './buildAgentPrompt'

export function buildCitationInstructions(
  referenceTool: NonNullable<BuildAgentPromptOptions['referenceTool']>,
  includeKnowledge: boolean
): string | undefined {
  const toolNames = [WEB_SEARCH_TOOL_NAME, WEB_FETCH_TOOL_NAME]
  const reference = (name: string) => referenceTool('cherry-tools', name)
  const lookups = [
    toolNames.map(reference).filter(Boolean).join(' / '),
    includeKnowledge && [KB_SEARCH_TOOL_NAME, KB_READ_TOOL_NAME].map(reference).filter(Boolean).join(' / ')
  ].filter(Boolean)
  if (!lookups.length) return undefined
  const tools = lookups.join(' and ')
  return `## Citations

Results from ${tools} each carry an \`id\` field. When a statement in your reply is based on one of those results, append a citation marker immediately after it: [cite:ID] with the exact id (e.g. "Prices rose 3% in June. [cite:3f2a1b9c-2]"). Chain markers when several results support one statement: [cite:3f2a1b9c-1][cite:7d4e0a51-3]. Copy ids exactly — never invent or renumber them — and do not add a "References" or "Sources" section: the app renders citations from the inline markers.`
}
