import { fetchGenerate } from '@renderer/utils/aiGeneration'
import type { Model } from '@shared/data/types/model'
import type { InstalledSkill } from '@shared/types/skill'

/** Upper bound for one model call during "Agent create"; the step falls back when it expires. */
export const AGENT_AUTO_CREATE_STEP_TIMEOUT_MS = 60_000

export const AGENT_AUTO_PROMPT_SYSTEM_PROMPT = [
  "You write the system prompt for an AI agent from the agent's name and, optionally, its purpose.",
  'If a purpose is given, build on it: keep every requirement it states and add only what the role needs to work well.',
  'If only a name is given, infer the role from the name and state its basic working principles.',
  'Cover the role, responsibilities, working principles, and what good output looks like, using Markdown headings and lists.',
  "Write in the same language as the user's input.",
  'Return only the system prompt with no explanation, wrapper, or code fence.'
].join('\n')

/** Abort when the caller cancels or the step runs past its timeout. */
export function withStepTimeout(signal: AbortSignal | undefined, timeoutMs = AGENT_AUTO_CREATE_STEP_TIMEOUT_MS) {
  const timeout = AbortSignal.timeout(timeoutMs)
  return signal ? AbortSignal.any([signal, timeout]) : timeout
}

/**
 * Write the new Agent's system prompt from its name and purpose. Falls back to the user's own words
 * (purpose, else name) so a failed or empty generation never blocks creation.
 */
export async function generateAgentInstructions({
  name,
  purpose,
  model,
  signal
}: {
  name: string
  purpose: string
  model?: Model
  signal?: AbortSignal
}): Promise<{ instructions: string; generated: boolean }> {
  const fallback = purpose.trim() || name.trim()
  try {
    const text = await fetchGenerate({
      prompt: AGENT_AUTO_PROMPT_SYSTEM_PROMPT,
      content: purpose.trim() ? `Name: ${name.trim()}\nPurpose: ${purpose.trim()}` : `Name: ${name.trim()}`,
      model,
      throwOnError: true,
      signal: withStepTimeout(signal)
    })
    const instructions = text.trim()
    return instructions ? { instructions, generated: true } : { instructions: fallback, generated: false }
  } catch {
    signal?.throwIfAborted()
    return { instructions: fallback, generated: false }
  }
}

/** Skills a new Agent should enable: every globally enabled one; builtin skills are enabled server-side. */
export function selectInstalledSkillIds(skills: readonly InstalledSkill[]): string[] {
  return skills.filter((skill) => skill.isGlobalEnabled && skill.source !== 'builtin').map((skill) => skill.id)
}
