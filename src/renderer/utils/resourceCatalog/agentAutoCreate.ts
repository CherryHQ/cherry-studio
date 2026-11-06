import { loggerService } from '@logger'
import { fetchGenerate } from '@renderer/utils/aiGeneration'
import { searchSkills } from '@renderer/utils/skillSearch'
import type { Model } from '@shared/data/types/model'
import type { InstalledSkill, SkillSearchResult } from '@shared/types/skill'

const logger = loggerService.withContext('agentAutoCreate')

/** Upper bound for one model call during "Agent create"; the step falls back when it expires. */
export const AGENT_AUTO_CREATE_STEP_TIMEOUT_MS = 60_000

/** Automatic installs run third-party code without per-skill confirmation, so keep them few. */
export const MAX_RECOMMENDED_SKILLS = 2
const MAX_SKILL_QUERIES = 3
const MAX_SKILL_CANDIDATES = 12

export const AGENT_AUTO_PROMPT_SYSTEM_PROMPT = [
  "You write the system prompt for an AI agent from the agent's name and, optionally, its purpose.",
  'If a purpose is given, build on it: keep every requirement it states and add only what the role needs to work well.',
  'If only a name is given, infer the role from the name and state its basic working principles.',
  'Cover the role, responsibilities, working principles, and what good output looks like, using Markdown headings and lists.',
  "Write in the same language as the user's input.",
  'Return only the system prompt with no explanation, wrapper, or code fence.'
].join('\n')

function describeAgent(name: string, purpose: string) {
  return purpose.trim() ? `Name: ${name.trim()}\nPurpose: ${purpose.trim()}` : `Name: ${name.trim()}`
}

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
      content: describeAgent(name, purpose),
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

export const AGENT_SKILL_QUERY_SYSTEM_PROMPT = [
  "You help equip an AI agent with skills (installable capabilities such as 'pptx', 'pdf', or 'web research').",
  "From the agent's name and purpose, return 1 to 3 short English search queries for a skill marketplace.",
  'Prefer concrete file formats, tools, and tasks over generic words.',
  'Return only a JSON array of strings.'
].join('\n')

export const AGENT_SKILL_PICK_SYSTEM_PROMPT = [
  "You choose marketplace skills for an AI agent from a numbered list, given the agent's name and purpose.",
  `Pick at most ${MAX_RECOMMENDED_SKILLS} skills that directly help with the purpose; prefer widely used ones.`,
  'Skip anything only loosely related. Return only a JSON array of the chosen numbers, or [] if none fit.'
].join('\n')

/** Read the first JSON array in a model reply; anything unparsable counts as an empty answer. */
export function parseJsonArray(text: string): unknown[] {
  const match = text.match(/\[[\s\S]*\]/)
  if (!match) return []
  try {
    const value: unknown = JSON.parse(match[0])
    return Array.isArray(value) ? value : []
  } catch {
    return []
  }
}

/**
 * Find marketplace skills worth installing for a new Agent: the model proposes search queries, the
 * existing registries are searched, and the model picks at most {@link MAX_RECOMMENDED_SKILLS} from
 * the results. Skills whose name is already installed are never suggested. Every failure (model,
 * search, unparsable reply) narrows the result instead of throwing, except caller cancellation.
 */
export async function recommendMarketplaceSkills({
  name,
  purpose,
  model,
  installedNames,
  signal
}: {
  name: string
  purpose: string
  model?: Model
  installedNames: readonly string[]
  signal?: AbortSignal
}): Promise<SkillSearchResult[]> {
  const agent = describeAgent(name, purpose)
  const ask = async (prompt: string, content: string) => {
    try {
      return await fetchGenerate({ prompt, content, model, throwOnError: true, signal: withStepTimeout(signal) })
    } catch (error) {
      signal?.throwIfAborted()
      logger.warn('Skill recommendation model call failed', { error })
      return ''
    }
  }

  const queries = parseJsonArray(await ask(AGENT_SKILL_QUERY_SYSTEM_PROMPT, agent))
    .filter((query): query is string => typeof query === 'string' && query.trim().length > 0)
    .slice(0, MAX_SKILL_QUERIES)
  if (queries.length === 0) return []

  const installed = new Set(installedNames.map((installedName) => installedName.toLowerCase()))
  const candidates = new Map<string, SkillSearchResult>()
  for (const query of queries) {
    signal?.throwIfAborted()
    try {
      for (const result of await searchSkills(query)) {
        if (!installed.has(result.name.toLowerCase())) candidates.set(result.installSource, result)
      }
    } catch (error) {
      logger.warn('Skill marketplace search failed', { query, error })
    }
  }
  const ranked = [...candidates.values()].sort((a, b) => b.downloads - a.downloads).slice(0, MAX_SKILL_CANDIDATES)
  if (ranked.length === 0) return []

  const list = ranked
    .map((skill, index) => `${index + 1}. ${skill.name} — ${skill.description ?? ''} (${skill.downloads} downloads)`)
    .join('\n')
  const picked = parseJsonArray(await ask(AGENT_SKILL_PICK_SYSTEM_PROMPT, `${agent}\n\nSkills:\n${list}`))
  const chosen = new Set<SkillSearchResult>()
  for (const index of picked) {
    const skill = typeof index === 'number' ? ranked[index - 1] : undefined
    if (skill) chosen.add(skill)
  }
  return [...chosen].slice(0, MAX_RECOMMENDED_SKILLS)
}
