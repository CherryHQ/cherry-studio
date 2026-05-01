/**
 * TODO：distinguish static and dynamic system prompt and xml-based user prompt
 */

import { replacePromptVariables } from '@main/utils/prompt'
import type { Assistant } from '@shared/data/types/assistant'
import type { Model } from '@shared/data/types/model'
import type { ToolSet } from 'ai'

import { getDeferredToolsSystemPrompt } from '../../prompts/deferredTools'
import { TOOL_SEARCH_TOOL_NAME } from '../../tools/meta/toolSearch'
import type { ToolEntry } from '../../tools/types'

export interface AssembleSystemPromptInput {
  assistant?: Assistant
  model: Model
  /** Final tool set going to the model — checked for `tool_search` membership. */
  tools?: ToolSet
  /** Entries hidden behind `tool_search`. Used to build the namespace inventory. */
  deferredEntries?: readonly ToolEntry[]
}

export async function assembleSystemPrompt(input: AssembleSystemPromptInput): Promise<string | undefined> {
  const { assistant, model, tools, deferredEntries } = input

  const sections: string[] = []

  // FIXME： maybe break cache
  if (assistant?.prompt) {
    const resolved = await replacePromptVariables(assistant.prompt, model.name)
    if (resolved) sections.push(resolved)
  }

  if (tools && TOOL_SEARCH_TOOL_NAME in tools) {
    sections.push(getDeferredToolsSystemPrompt(deferredEntries))
  }

  if (sections.length === 0) return undefined
  return sections.join('\n\n')
}
