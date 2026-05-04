/**
 * Thin compatibility shim — the actual section registry lives in
 * `src/main/ai/agent/prompts/sections/`. Keep this entry point so
 * `buildAgentParams.ts` and existing tests don't have to learn the
 * registry today; once Phase B settles we can collapse callers to
 * `buildSystemPrompt + renderSystemPrompt` directly.
 */

import type { Assistant } from '@shared/data/types/assistant'
import type { Model } from '@shared/data/types/model'
import type { ToolSet } from 'ai'

import type { ToolEntry } from '../../tools/types'
import { buildSystemPrompt } from '../prompts/sections/buildSystemPrompt'
import { renderSystemPrompt } from '../prompts/sections/renderSystemPrompt'

export interface AssembleSystemPromptInput {
  assistant?: Assistant
  model: Model
  /** Topic's bound workspace path; drives `env` section + git detection. */
  workspaceRoot?: string | null
  /** Final tool set going to the model — checked for `tool_search` membership. */
  tools?: ToolSet
  /** Entries hidden behind `tool_search`. Used to build the namespace inventory. */
  deferredEntries?: readonly ToolEntry[]
}

export async function assembleSystemPrompt(input: AssembleSystemPromptInput): Promise<string | undefined> {
  const sections = await buildSystemPrompt(input)
  return renderSystemPrompt(sections)
}
