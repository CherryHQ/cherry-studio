/**
 * Skill types — shared across loader sources, merger, catalog,
 * system prompt section, and the `skills__load` builtin tool.
 *
 * Identity is two-keyed:
 *   - `name` — the user-facing key (matches frontmatter); used for
 *     dedup across sources (priority HIGH wins).
 *   - `path` — the canonical absolute path to `SKILL.md` (after
 *     symlink resolution); used to dedup the same physical file
 *     surfaced through multiple sources.
 */

export type SourceId =
  | 'db'
  | 'workspace-cherry'
  | 'workspace-claude'
  | 'cherry-global'
  | 'claude-global'
  | 'codex-global'
  | 'agent-global'

export interface Skill {
  /** Stable id derived from `${source}::${name}`. */
  id: string
  name: string
  description: string
  body: string
  source: SourceId
  /** Canonical absolute path (realpath-resolved) to the source file. */
  path: string
  /** sha256 of `body` — used for cache stability and equivalence checks. */
  contentHash: string
  /** Frontmatter `allowed-tools`; v1 parsed but not enforced. */
  allowedTools?: string[]
}

export interface SkillCtx {
  workspaceRoot: string | null
  /** Override for tests; defaults to `os.homedir()`. */
  homeDir?: string
}

/** Preference keys that gate the opt-in third-party global sources. */
export type OptInPreferenceKey =
  | 'feature.skills.include_claude_global'
  | 'feature.skills.include_codex_global'
  | 'feature.skills.include_agent_global'
