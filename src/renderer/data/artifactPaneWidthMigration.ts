import { DefaultRendererPersistCache, type RendererPersistCacheKey } from '@shared/data/cache/cacheSchemas'

const ARTIFACT_PANE_WIDTH_KEY = 'ui.chat.artifact_pane.width' as const
const ARTIFACT_PANE_WIDTH_VERSION_KEY = 'ui.chat.artifact_pane.width_version' as const
const LEGACY_ARTIFACT_PANE_AUTO_WIDTH = 460

/**
 * One-shot persist default transition for the chat/agent artifact pane.
 * Must run against the raw stored record: loadPersistCache seeds missing keys
 * with schema defaults, so an absent version marker would otherwise look current.
 */
export function migrateArtifactPaneWidthDefault(
  stored: Record<string, unknown>,
  persistCache: Pick<Map<RendererPersistCacheKey, unknown>, 'set'>
): void {
  const currentVersion = DefaultRendererPersistCache[ARTIFACT_PANE_WIDTH_VERSION_KEY]
  if (stored[ARTIFACT_PANE_WIDTH_VERSION_KEY] === currentVersion) return

  if (stored[ARTIFACT_PANE_WIDTH_KEY] === LEGACY_ARTIFACT_PANE_AUTO_WIDTH) {
    persistCache.set(ARTIFACT_PANE_WIDTH_KEY, DefaultRendererPersistCache[ARTIFACT_PANE_WIDTH_KEY])
  }
  persistCache.set(ARTIFACT_PANE_WIDTH_VERSION_KEY, currentVersion)
}
