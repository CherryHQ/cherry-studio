/**
 * Source configuration for the skill catalog. Listed in priority
 * LOW → HIGH order: later entries overwrite earlier ones on `name`
 * collision in the merger. Workspace > global; project-specific
 * skills win over user-global, which win over opt-in third-party
 * locations.
 */

import { join } from 'node:path'

import type { OptInPreferenceKey, SkillCtx, SourceId } from '../types'

export interface FilesystemSourceConfig {
  sourceId: SourceId
  /**
   * Resolves the absolute root dir to scan, given the build context.
   * Returns `null` to skip the source (workspace not bound, opt-in
   * not enabled, etc.).
   */
  resolveRoot: (ctx: SkillCtx) => string | null
  /**
   * Optional preference key gating this source. `undefined` means
   * always-on. The catalog reads the preference and skips when false.
   */
  optInPreference?: OptInPreferenceKey
}

export const FILESYSTEM_SOURCES: FilesystemSourceConfig[] = [
  // ── Lowest priority — opt-in third-party globals ──
  {
    sourceId: 'agent-global',
    resolveRoot: (ctx) => join(ctx.homeDir!, '.agent', 'skills'),
    optInPreference: 'feature.skills.include_agent_global'
  },
  {
    sourceId: 'codex-global',
    resolveRoot: (ctx) => join(ctx.homeDir!, '.codex', 'skills'),
    optInPreference: 'feature.skills.include_codex_global'
  },
  {
    sourceId: 'claude-global',
    resolveRoot: (ctx) => join(ctx.homeDir!, '.claude', 'skills'),
    optInPreference: 'feature.skills.include_claude_global'
  },

  // ── Cherry's own global, always read ──
  // {
  //   sourceId: 'cherry-global',
  //   resolveRoot: (ctx) => join(ctx.homeDir!, '.cherry', 'skills')
  // },

  // ── Workspace-scoped — only if a workspace is bound ──
  {
    sourceId: 'workspace-claude',
    resolveRoot: (ctx) => (ctx.workspaceRoot ? join(ctx.workspaceRoot, '.claude', 'skills') : null)
  },
  {
    sourceId: 'workspace-cherry',
    resolveRoot: (ctx) => (ctx.workspaceRoot ? join(ctx.workspaceRoot, '.cherry', 'skills') : null)
  }
]
