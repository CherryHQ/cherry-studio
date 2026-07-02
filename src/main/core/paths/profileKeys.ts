import type { PathKey } from './pathRegistry'

/**
 * Path keys whose value holds per-profile user content and therefore relocates
 * with the active profile (RFC §4.1). Every other key is app-level and stays
 * constant across profile switches.
 *
 * Classified by content, not location: the userData/Data subtree plus the
 * SQLite database, and the reverse-intuitive per-identity items that
 * historically live under ~/.cherrystudio (AI trace stores inputs/outputs, MCP
 * OAuth / memory, Copilot token) — their content is per-profile even though
 * their legacy location is a shared directory.
 *
 * Membership is a design decision: adding or removing a key moves that data
 * between the app-global and per-profile stores. `satisfies readonly PathKey[]`
 * pins every entry to a real registry key (a typo or stale key fails to compile).
 */
export const PROFILE_PATH_KEYS = [
  // userData/Data subtree + the database
  'app.database.file',
  'app.userdata.data',
  'feature.files.data',
  'feature.notes.data',
  'feature.knowledgebase.data',
  'feature.mcp.workspace',
  'feature.agents.skills',
  'feature.agents.channels',
  'feature.agents.workspaces',
  'feature.agents.claude.root',
  'feature.agents.claude.skills',
  // per-identity / per-profile content whose legacy location is under ~/.cherrystudio
  'feature.mcp.oauth',
  'feature.mcp.memory_file',
  'feature.copilot.token_file',
  'feature.trace'
] as const satisfies readonly PathKey[]

/** A path key whose value relocates with the active profile. */
export type ProfilePathKey = (typeof PROFILE_PATH_KEYS)[number]

const PROFILE_PATH_KEY_SET: ReadonlySet<PathKey> = new Set(PROFILE_PATH_KEYS)

/**
 * Whether `key`'s value is per-profile (relocates on switch). The negation is
 * app-level: its value is identical under every profile.
 */
export function isProfilePathKey(key: PathKey): key is ProfilePathKey {
  return PROFILE_PATH_KEY_SET.has(key)
}
