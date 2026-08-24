import { application } from '@application'
import type { AgentEntity } from '@shared/data/api/schemas/agents'
import { AgentLanguageSchema } from '@shared/data/types/agentLanguage'

/** Trimmed, non-empty, length-bounded label via the shared schema; null when invalid. */
function normalizeAgentLanguage(value: unknown): string | null {
  const parsed = AgentLanguageSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

/**
 * Pure precedence rule between the two language sources:
 *
 * - Per-agent `configuration.language`: non-empty string overrides; `null`
 *   explicitly opts out; anything else inherits the global value.
 * - Global `agent.language` preference: valid label = default; null/invalid = none.
 */
export function resolveEffectiveAgentLanguage(
  agent: AgentEntity,
  globalLanguage: string | null | undefined
): string | null {
  const perAgent = agent.configuration?.language

  if (perAgent === null) return null
  return normalizeAgentLanguage(perAgent) ?? normalizeAgentLanguage(globalLanguage)
}

/**
 * Resolve the effective reply language for an agent against the live
 * `agent.language` preference. Unlike the pure rule above, this reads ambient
 * state and does not swallow errors: a failing PreferenceService must surface
 * to the caller constructing the connection/prompt, not silently drop the
 * language constraint.
 *
 * Values are human-readable language labels (e.g. "English", "ไทย"), not app locale codes.
 */
export function getEffectiveAgentLanguage(agent: AgentEntity): string | null {
  return resolveEffectiveAgentLanguage(agent, application.get('PreferenceService').get('agent.language'))
}
