import { miniappTable } from '@data/db/schemas/miniapp'
import { type MiniappPreset, PRESETS_MINIAPPS } from '@shared/data/presets/minapps'

import type { DbType, ISeed } from '../types'

// Helper to map preset to db row
const presetToDbRow = (preset: MiniappPreset, sortOrder: number) => ({
  appId: preset.appId,
  name: preset.name,
  nameKey: preset.nameKey || null,
  url: preset.url,
  logo: preset.icon,
  type: 'default' as const,
  status: 'enabled' as const,
  sortOrder,
  bordered: preset.bordered ?? true,
  background: preset.background || null,
  supportedRegions: preset.supportedRegions || ['CN', 'Global'],
  configuration: null
})

class MiniAppSeed implements ISeed {
  async migrate(db: DbType): Promise<void> {
    // Get all existing miniapps
    const existingApps = await db.select().from(miniappTable)

    // Get existing default appIds
    const existingAppIds = new Set(existingApps.filter((app) => app.type === 'default').map((app) => app.appId))

    // Filter out already existing apps from presets
    const newApps: Parameters<typeof presetToDbRow>[0][] = []

    for (const preset of PRESETS_MINIAPPS) {
      if (!existingAppIds.has(preset.appId)) {
        newApps.push(preset)
      }
    }

    // Insert new apps with calculated sort order
    if (newApps.length > 0) {
      // Calculate starting sort order based on existing default apps
      const existingDefaultCount = existingApps.filter((app) => app.type === 'default').length

      const values = newApps.map((preset, index) => presetToDbRow(preset, existingDefaultCount + index))

      await db.insert(miniappTable).values(values)
    }
  }
}

export default MiniAppSeed
