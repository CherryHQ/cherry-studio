/**
 * TODO：distinguish static and dynamic system prompt and xml-based user prompt
 */

import { replacePromptVariables } from '@main/utils/prompt'
import { KB_SEARCH_TOOL_NAME, WEB_FETCH_TOOL_NAME, WEB_SEARCH_TOOL_NAME } from '@shared/ai/builtinTools'
import type { Assistant } from '@shared/data/types/assistant'
import type { Model } from '@shared/data/types/model'
import type { ToolSet } from 'ai'

import { TOOL_SEARCH_TOOL_NAME } from '../../../tools/adapters/aiSdk/meta/toolSearch'
import type { ToolEntry } from '../../../tools/adapters/aiSdk/types'
import { CITATIONS_SYSTEM_PROMPT } from '../prompts/citations'
import { getDeferredToolsSystemPrompt } from '../prompts/deferredTools'

/** Lookup tools whose results carry citation ids — their presence turns on the citation guidance. */
const CITE_TOOL_NAMES: ReadonlySet<string> = new Set([WEB_SEARCH_TOOL_NAME, WEB_FETCH_TOOL_NAME, KB_SEARCH_TOOL_NAME])

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

  // `anthropic-cache` checks the original assistant prompt for volatile time variables before caching.
  if (assistant?.prompt) {
    const resolved = await replacePromptVariables(assistant.prompt, model.name)
    if (resolved) sections.push(resolved)
  }

  if (tools && TOOL_SEARCH_TOOL_NAME in tools) {
    sections.push(getDeferredToolsSystemPrompt(deferredEntries))
  }

  // A deferred lookup tool is still invocable via tool_invoke, so it counts too.
  const hasCiteTools =
    (tools != null && Object.keys(tools).some((name) => CITE_TOOL_NAMES.has(name))) ||
    (deferredEntries?.some((entry) => CITE_TOOL_NAMES.has(entry.name)) ?? false)
  if (hasCiteTools) {
    sections.push(CITATIONS_SYSTEM_PROMPT)
  }

  if (sections.length === 0) return undefined
  return sections.join('\n\n')
}
