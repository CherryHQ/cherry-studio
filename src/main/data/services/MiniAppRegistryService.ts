/**
 * MiniApp Registry Service — preset re-sync.
 *
 * Per docs/references/data/best-practice-layered-preset-pattern.md
 * §"Large-Scale Scenario", the Registry Service bridges preset data with the
 * Entity Service. For miniapp this is a thin facade with one purpose:
 * trigger a {@link MiniAppService.batchUpsertPresets} call at boot/admin time
 * so {@link PRESETS_MINI_APPS} edits propagate into the DB while preserving
 * `userOverrides` (same mechanism as ModelService.batchUpsert).
 *
 * Read paths and write paths go directly through {@link MiniAppService}.
 * Handlers do **not** import this service.
 */

import { loggerService } from '@logger'

import { miniAppService } from './MiniAppService'

const logger = loggerService.withContext('DataApi:MiniAppRegistryService')

class MiniAppRegistryService {
  /**
   * Re-sync all preset miniapps into the DB. Called at boot or via admin.
   * User-overridden fields (per row's `userOverrides`) are preserved.
   */
  async syncPresets(): Promise<void> {
    logger.info('Syncing preset miniapps from PRESETS_MINI_APPS')
    await miniAppService.batchUpsertPresets()
  }
}

export const miniAppRegistryService = new MiniAppRegistryService()
