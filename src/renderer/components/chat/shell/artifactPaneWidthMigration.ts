import { DefaultRendererPersistCache } from '@shared/data/cache/cacheSchemas'

const ARTIFACT_PANE_WIDTH_KEY = 'ui.chat.artifact_pane.width' as const
const ARTIFACT_PANE_WIDTH_VERSION_KEY = 'ui.chat.artifact_pane.width_version' as const
const LEGACY_ARTIFACT_PANE_AUTO_WIDTH = 460
/** Persist stamp written after the one-shot transition. Schema default 0 means unmigrated. */
export const ARTIFACT_PANE_WIDTH_CURRENT_VERSION = 1

type ArtifactPaneWidthCache = {
  getPersist(key: typeof ARTIFACT_PANE_WIDTH_KEY | typeof ARTIFACT_PANE_WIDTH_VERSION_KEY): number
  setPersist(key: typeof ARTIFACT_PANE_WIDTH_KEY | typeof ARTIFACT_PANE_WIDTH_VERSION_KEY, value: number): void
}

/**
 * One-shot persist default transition for the chat/agent artifact pane.
 * Treats a missing/0 version as unmigrated so CacheService default-seeding cannot
 * mark a historical 460 px width as already current.
 */
export function migrateArtifactPaneWidthDefault(stored: Record<string, unknown>): boolean {
  if (stored[ARTIFACT_PANE_WIDTH_VERSION_KEY] === ARTIFACT_PANE_WIDTH_CURRENT_VERSION) return false

  if (stored[ARTIFACT_PANE_WIDTH_KEY] === LEGACY_ARTIFACT_PANE_AUTO_WIDTH) {
    stored[ARTIFACT_PANE_WIDTH_KEY] = DefaultRendererPersistCache[ARTIFACT_PANE_WIDTH_KEY]
  }
  stored[ARTIFACT_PANE_WIDTH_VERSION_KEY] = ARTIFACT_PANE_WIDTH_CURRENT_VERSION
  return true
}

/** Applies the one-shot transition to an already-loaded persist cache. Idempotent. */
export function migrateLoadedArtifactPaneWidth(cache: ArtifactPaneWidthCache): void {
  const stored: Record<string, unknown> = {
    [ARTIFACT_PANE_WIDTH_KEY]: cache.getPersist(ARTIFACT_PANE_WIDTH_KEY),
    [ARTIFACT_PANE_WIDTH_VERSION_KEY]: cache.getPersist(ARTIFACT_PANE_WIDTH_VERSION_KEY)
  }
  if (!migrateArtifactPaneWidthDefault(stored)) return

  const nextWidth = stored[ARTIFACT_PANE_WIDTH_KEY] as number
  const nextVersion = stored[ARTIFACT_PANE_WIDTH_VERSION_KEY] as number
  if (nextWidth !== cache.getPersist(ARTIFACT_PANE_WIDTH_KEY)) {
    cache.setPersist(ARTIFACT_PANE_WIDTH_KEY, nextWidth)
  }
  cache.setPersist(ARTIFACT_PANE_WIDTH_VERSION_KEY, nextVersion)
}
