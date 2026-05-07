/**
 * System prompt section builder.
 *
 * The CONTRIBUTORS array is the single source of truth for ordering.
 * Cacheable sections come first (stable across calls within a session,
 * benefit from prompt caching on Anthropic), non-cacheable last
 * (volatile per call or mid-session). The builder runs each
 * contributor, drops empty/undefined results, and returns an array;
 * `renderSystemPrompt` does the final concatenation.
 *
 * Adding a section: append the contributor in the right position
 * below, and add the new id to `SectionId` in `types.ts`. Phases C / E
 * / F will register more.
 */

import { actionsSection } from './actionsSection'
import { agentDisciplineSection } from './agentDisciplineSection'
import { assistantPromptSection } from './assistantPromptSection'
import { codeWorkflowSection } from './codeWorkflowSection'
import { compactionHintSection } from './compactionHintSection'
import { compressionHintSection } from './compressionHintSection'
import { envSection } from './envSection'
import { identitySection } from './identitySection'
import { outputStyleSection } from './outputStyleSection'
import { persistedOutputSection } from './persistedOutputSection'
import { skillsCatalogSection } from './skillsCatalogSection'
import { systemRulesSection } from './systemRulesSection'
import { toneAndOutputSection } from './toneAndOutputSection'
import { toolIntrosSection } from './toolIntrosSection'
import type { BuildSystemPromptCtx, SectionContributor, SystemSection } from './types'

const CONTRIBUTORS: SectionContributor[] = [
  // ── Cacheable group ──────────────────────────────────────────────
  // Frozen prose first (most stable), then user/toolset-derived prose.
  identitySection,
  systemRulesSection,
  // Behavior contracts for context-chef. Gated on contextSettings.enabled;
  // sit next to agentDisciplineSection because they're conceptually peer behavior contracts.
  persistedOutputSection,
  compactionHintSection,
  compressionHintSection,
  agentDisciplineSection,
  actionsSection,
  toneAndOutputSection,
  codeWorkflowSection, // gated on fs__/shell__ tools — drops out for non-code assistants
  assistantPromptSection,
  toolIntrosSection,
  skillsCatalogSection, // empty when no skills installed; otherwise stable per-session

  // ── Non-cacheable group ──────────────────────────────────────────
  // env date shifts hourly; output_style flips on user preference.
  envSection,
  outputStyleSection
]

export async function buildSystemPrompt(ctx: BuildSystemPromptCtx): Promise<SystemSection[]> {
  const results = await Promise.all(CONTRIBUTORS.map((contribute) => contribute(ctx)))
  return results.filter((section): section is SystemSection => !!section && section.text.trim().length > 0)
}
