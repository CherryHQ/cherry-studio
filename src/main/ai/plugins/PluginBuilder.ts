import type { AiPlugin } from '@cherrystudio/ai-core'

/**
 * Build the plugin array for createAgent().
 *
 * Phase 1: returns empty array. Existing plugin files (reasoningExtraction,
 * noThink, etc.) will be wired in later phases.
 */
export function buildPlugins(): AiPlugin[] {
  return []
}
