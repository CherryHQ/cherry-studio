import type { RendererPersistCacheKey } from '@shared/data/cache/cacheSchemas'
import { describe, expect, it } from 'vitest'

import { migrateArtifactPaneWidthDefault } from '../artifactPaneWidthMigration'

function persistCacheFromStored(stored: Record<string, unknown>) {
  const persistCache = new Map<RendererPersistCacheKey, unknown>()
  for (const [key, value] of Object.entries(stored)) {
    persistCache.set(key as RendererPersistCacheKey, value)
  }
  return persistCache
}

describe('migrateArtifactPaneWidthDefault', () => {
  it('moves an unmarked historical 460 px default to 280 px and stamps the version', () => {
    const stored = { 'ui.chat.artifact_pane.width': 460 }
    const persistCache = persistCacheFromStored(stored)

    migrateArtifactPaneWidthDefault(stored, persistCache)

    expect(persistCache.get('ui.chat.artifact_pane.width')).toBe(280)
    expect(persistCache.get('ui.chat.artifact_pane.width_version')).toBe(1)
  })

  it('stamps the version without replacing a distinct saved width', () => {
    const stored = { 'ui.chat.artifact_pane.width': 500 }
    const persistCache = persistCacheFromStored(stored)

    migrateArtifactPaneWidthDefault(stored, persistCache)

    expect(persistCache.get('ui.chat.artifact_pane.width')).toBe(500)
    expect(persistCache.get('ui.chat.artifact_pane.width_version')).toBe(1)
  })

  it('leaves an already-stamped 460 px width in place', () => {
    const stored = {
      'ui.chat.artifact_pane.width': 460,
      'ui.chat.artifact_pane.width_version': 1
    }
    const persistCache = persistCacheFromStored(stored)

    migrateArtifactPaneWidthDefault(stored, persistCache)

    expect(persistCache.get('ui.chat.artifact_pane.width')).toBe(460)
    expect(persistCache.get('ui.chat.artifact_pane.width_version')).toBe(1)
  })
})
