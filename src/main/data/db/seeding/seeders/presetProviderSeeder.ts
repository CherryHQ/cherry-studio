import { asc, desc, eq, ne } from 'drizzle-orm'

import type { ProtoProviderConfig } from '@cherrystudio/provider-registry'
import { RegistryLoader } from '@cherrystudio/provider-registry/node'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { providerService } from '@data/services/ProviderService'
import { generateOrderKeySequenceBetween } from '@data/services/utils/orderKey'
import { resolveRegistryPaths } from '@data/services/utils/registryDataPaths'
import { loggerService } from '@logger'
import type { AuthConfig } from '@shared/data/types/provider'

import type { DbType, ISeeder } from '../../types'

const logger = loggerService.withContext('PresetProviderSeeder')
const SEEDER_REVISION = 1
const LEGACY_INVALID_ORDER_KEY = 'zz'

/**
 * Seed rows are DELTA rows: registry-owned connection config
 * (endpointConfigs, defaultChatEndpoint) is NOT persisted —
 * it resolves from the registry at read time (#17096), so registry updates
 * reach existing installs without reconciliation. Only user-editable
 * scaffolding is seeded: identity, display name, and the auth shell below.
 *
 * Per the v2 invariant in `ProviderSettings/utils/provider.ts` ("Azure/Vertex/Bedrock
 * reuse other vendors' endpoint protocols, so authType is the only reliable
 * discriminator"), vendor URL routing for those providers is driven by
 * `authType` (`iam-azure` → AI SDK `createAzure`, `iam-gcp` → Vertex SDK).
 */
function getSeedAuthConfig(providerId: string): AuthConfig | null {
  if (providerId === 'vertexai') {
    return { type: 'iam-gcp', project: '', location: '' }
  }

  if (providerId === 'azure-openai') {
    return { type: 'iam-azure', apiVersion: '' }
  }

  if (providerId === 'aws-bedrock') {
    return { type: 'iam-aws', region: '' }
  }

  return null
}

function toDbRow(p: ProtoProviderConfig) {
  return {
    providerId: p.id,
    presetProviderId: p.presetProviderId ?? p.id,
    name: p.name,
    authConfig: getSeedAuthConfig(p.id)
  }
}

export class PresetProviderSeeder implements ISeeder {
  readonly name = 'presetProvider'
  readonly description = 'Insert preset provider configurations'

  private _loader?: RegistryLoader

  private getLoader(): RegistryLoader {
    if (!this._loader) {
      this._loader = new RegistryLoader(resolveRegistryPaths())
    }
    return this._loader
  }

  get version(): string {
    return `${this.getLoader().getProvidersVersion()}:${SEEDER_REVISION}`
  }

  run(db: DbType): void {
    let rawProviders: ProtoProviderConfig[]
    try {
      rawProviders = this.getLoader().loadProviders()
    } catch (error) {
      throw new Error('PresetProviderSeeder: failed to load registry providers', { cause: error })
    }

    const rows = rawProviders.map(toDbRow)

    db.transaction((tx) => {
      const invalidProviders = tx
        .select({ providerId: userProviderTable.providerId })
        .from(userProviderTable)
        .where(eq(userProviderTable.orderKey, LEGACY_INVALID_ORDER_KEY))
        .orderBy(asc(userProviderTable.providerId))
        .all()

      if (invalidProviders.length > 0) {
        const [lastValidProvider] = tx
          .select({ orderKey: userProviderTable.orderKey })
          .from(userProviderTable)
          .where(ne(userProviderTable.orderKey, LEGACY_INVALID_ORDER_KEY))
          .orderBy(desc(userProviderTable.orderKey))
          .limit(1)
          .all()
        const repairedKeys = generateOrderKeySequenceBetween(
          lastValidProvider?.orderKey ?? null,
          null,
          invalidProviders.length
        )

        invalidProviders.forEach((provider, index) => {
          tx.update(userProviderTable)
            .set({ orderKey: repairedKeys[index] })
            .where(eq(userProviderTable.providerId, provider.providerId))
            .run()
        })
        logger.warn('Repaired legacy provider order keys', { count: invalidProviders.length })
      }

      if (rows.length > 0) {
        providerService.batchUpsertTx(tx, rows)
      }
    })
  }
}
