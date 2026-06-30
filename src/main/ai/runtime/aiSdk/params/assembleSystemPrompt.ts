/**
 * TODO：distinguish static and dynamic system prompt and xml-based user prompt
 */

import { replacePromptVariables } from '@main/utils/prompt'
import type { Assistant } from '@shared/data/types/assistant'
import type { Model } from '@shared/data/types/model'
import type { ToolSet } from 'ai'

import { TOOL_SEARCH_TOOL_NAME } from '../../../tools/adapters/aiSdk/meta/toolSearch'
import type { ToolEntry } from '../../../tools/adapters/aiSdk/types'
import { getDeferredToolsSystemPrompt } from '../prompts/deferredTools'

const KB_SYSTEM_INSTRUCTION = `You have access to the user's private knowledge base via the kb_search and kb_list tools. When the user asks a question that may relate to their stored documents or notes:
- Always attempt kb_search before answering from general knowledge.
- If kb_search returns no relevant results, you MUST tell the user explicitly that their knowledge base does not contain information on this topic, and clarify that your answer is based on general knowledge — not on their stored documents.
- Do not silently fall back to general knowledge without informing the user.`

export interface AssembleSystemPromptInput {
  assistant?: Assistant
  model: Model
  /** Final tool set going to the model — checked for `tool_search` membership. */
  tools?: ToolSet
  /** Entries hidden behind `tool_search`. Used to build the namespace inventory. */
  deferredEntries?: readonly ToolEntry[]
  /** Whether kb_search is active for this request. When true, inject the KB notification instruction. */
  kbSearchActive?: boolean
}

export async function assembleSystemPrompt(input: AssembleSystemPromptInput): Promise<string | undefined> {
  const { assistant, model, tools, deferredEntries, kbSearchActive } = input

  const sections: string[] = []

  // FIXME： maybe break cache
  if (assistant?.prompt) {
    const resolved = await replacePromptVariables(assistant.prompt, model.name)
    if (resolved) sections.push(resolved)
  }

  if (kbSearchActive) {
    sections.push(KB_SYSTEM_INSTRUCTION)
  }

  if (tools && TOOL_SEARCH_TOOL_NAME in tools) {
    sections.push(getDeferredToolsSystemPrompt(deferredEntries))
  }

  if (sections.length === 0) return undefined
  return sections.join('\n\n')
}
