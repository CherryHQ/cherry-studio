import { replacePromptVariables } from '@main/utils/prompt'

import type { SectionContributor } from './types'

/**
 * The assistant's user-configured system prompt body, after `{{var}}`
 * substitution. Cacheable — the assistant prompt is stable for the
 * lifetime of a session; we accept a cache miss on the rare case where
 * the user edits the prompt mid-session.
 */
export const assistantPromptSection: SectionContributor = async (ctx) => {
  const prompt = ctx.assistant?.prompt
  if (!prompt) return undefined

  const resolved = await replacePromptVariables(prompt, ctx.model.name)
  if (!resolved) return undefined

  return {
    id: 'assistant_prompt',
    text: resolved,
    cacheable: true
  }
}
