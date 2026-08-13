/**
 * TODO：distinguish static and dynamic system prompt and xml-based user prompt
 */

import { replacePromptVariables } from '@main/utils/prompt'
import type { Assistant } from '@shared/data/types/assistant'
import type { Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import type { ToolSet } from 'ai'

import { TOOL_SEARCH_TOOL_NAME } from '../../../tools/adapters/aiSdk/meta/toolSearch'
import type { ToolEntry } from '../../../tools/adapters/aiSdk/types'
import { CITATIONS_SYSTEM_PROMPT } from '../prompts/citations'
import { getDeferredToolsSystemPrompt } from '../prompts/deferredTools'

/**
 * Local patch (model identity): tells the model which provider/model it is
 * actually running on. Without this, models with Claude-heavy agent training
 * (e.g. DeepSeek V4) infer "this tool environment looks like Claude" and
 * answer "I am Claude" when asked — misleading users who are paying for a
 * different model. The identity section is emitted FIRST so it wins over
 * user prompt / history when the model is asked about itself.
 */
export function buildIdentitySection(model: Model, provider: Provider): string {
  const modelName = model.name || model.id
  const providerName = provider.name || provider.id
  return [
    '# Identity',
    '',
    `You are currently running on the model "${modelName}" (provider: ${providerName}).`,
    'When asked what model or AI you are, answer truthfully with the model name above.',
    'Do not claim to be a different model, company, or product.'
  ].join('\n')
}

export interface AssembleSystemPromptInput {
  assistant?: Assistant
  model: Model
  /** Local patch: provider carrying the request; used for the identity section. Optional so existing callers/tests keep working. */
  provider?: Provider
  /** Final tool set going to the model — checked for `tool_search` membership. */
  tools?: ToolSet
  /** Entries hidden behind `tool_search`. Used to build the namespace inventory. */
  deferredEntries?: readonly ToolEntry[]
  /** True only when a selected first-party lookup tool with the citation-id contract remains available. */
  hasCitableTools?: boolean
}

export async function assembleSystemPrompt(input: AssembleSystemPromptInput): Promise<string | undefined> {
  const { assistant, model, provider, tools, deferredEntries, hasCitableTools = false } = input

  const sections: string[] = []

  // Local patch: identity first, so "what model are you" is answered truthfully.
  // Controlled by the assistant's `injectModelIdentity` toggle (default on).
  if (provider && assistant?.settings?.injectModelIdentity !== false) {
    sections.push(buildIdentitySection(model, provider))
  }

  // `anthropic-cache` checks the original assistant prompt for volatile time variables before caching.
  if (assistant?.prompt) {
    const resolved = await replacePromptVariables(assistant.prompt, model.name)
    if (resolved) sections.push(resolved)
  }

  if (tools && TOOL_SEARCH_TOOL_NAME in tools) {
    sections.push(getDeferredToolsSystemPrompt(deferredEntries))
  }

  // No persisted-output section here: that protocol is taught in-band — the
  // marker itself carries the retrieval line (getVFSOffloadReminder) and the
  // fs_read tool description carries the paging + coverage contract — so
  // conversations that never truncate pay nothing for it.

  if (hasCitableTools) {
    sections.push(CITATIONS_SYSTEM_PROMPT)
  }

  if (sections.length === 0) return undefined
  return sections.join('\n\n')
}
