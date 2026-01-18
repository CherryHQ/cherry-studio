import { websearchProviderTable } from '@data/db/schemas/websearchProvider'
import { DefaultWebSearchProviders } from '@shared/data/api/schemas/websearch-providers'

import type { DbType, ISeed } from '../types'

class WebSearchProviderSeed implements ISeed {
  async migrate(db: DbType): Promise<void> {
    const existingProviders = await db.select().from(websearchProviderTable)

    // Create a Set of existing provider IDs for quick lookup
    const existingIds = new Set(existingProviders.map((p) => p.id))

    // Collect providers that don't exist yet
    const newProviders = DefaultWebSearchProviders.filter((provider) => !existingIds.has(provider.id)).map(
      (provider) => ({
        id: provider.id,
        name: provider.name,
        type: provider.type,
        apiKey: provider.apiKey ?? null,
        apiHost: provider.apiHost ?? null,
        engines: provider.engines ?? null,
        usingBrowser: provider.usingBrowser ?? false,
        basicAuthUsername: provider.basicAuthUsername ?? null,
        basicAuthPassword: provider.basicAuthPassword ?? null
      })
    )

    // Insert new providers if any
    if (newProviders.length > 0) {
      await db.insert(websearchProviderTable).values(newProviders)
    }
  }
}

export default WebSearchProviderSeed
