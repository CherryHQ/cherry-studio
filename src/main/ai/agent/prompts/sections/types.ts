/**
 * System prompt section registry — types shared across contributors,
 * the builder, and the renderer.
 *
 * Each section emits a small chunk of the final system prompt. The
 * `cacheable` flag determines which side of the (logical) cache
 * boundary the section belongs to — cacheable sections are stable for
 * the lifetime of an assistant session; non-cacheable change per call
 * or mid-session and would otherwise bust the cache for everything
 * after them.
 */

import type { Assistant } from '@shared/data/types/assistant'
import type { Model } from '@shared/data/types/model'
import type { ToolSet } from 'ai'

import type { ToolEntry } from '../../../tools/types'

/**
 * Stable identifier for a section. Adding a new id here is the only
 * place to register it; the contributor array in `buildSystemPrompt.ts`
 * pins ordering.
 */
export type SectionId =
  | 'identity'
  | 'system_rules'
  | 'agent_discipline'
  | 'actions'
  | 'code_workflow'
  | 'tone_and_output'
  | 'assistant_prompt'
  | 'tool_intros'
  | 'skills_catalog'
  | 'env'
  | 'output_style'

export interface SystemSection {
  id: SectionId
  text: string
  /**
   * `true` → emitted before the cache boundary; should be reused across
   * calls within a session. `false` → may change per call; emitted after
   * the boundary.
   */
  cacheable: boolean
}

/**
 * Inputs available to every contributor. Kept narrow so contributors
 * can be tested in isolation; whatever data a future section needs
 * gets added here once.
 */
export interface BuildSystemPromptCtx {
  assistant?: Assistant
  model: Model
  /** Absolute path the topic is bound to, if any. Drives `env` section + git detection. */
  workspaceRoot?: string | null
  /** Final tool set going to the model — checked for `tool_search` membership. */
  tools?: ToolSet
  /** Entries hidden behind `tool_search`, used by `tool_intros` to inventory namespaces. */
  deferredEntries?: readonly ToolEntry[]
}

/**
 * A section contributor is a pure (or async-pure) function: same ctx
 * → same section. Returning `undefined` (or a section with empty
 * `text`) tells the builder to drop the entry.
 */
export type SectionContributor = (
  ctx: BuildSystemPromptCtx
) => SystemSection | undefined | Promise<SystemSection | undefined>
