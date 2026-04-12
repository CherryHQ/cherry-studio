import { appStateTable } from '@data/db/schemas/appState'
import type { DbType, ISeeder } from '@data/db/types'
import { loggerService } from '@logger'
import { inArray } from 'drizzle-orm'

const logger = loggerService.withContext('SeedRunner')

const SEED_KEY_PREFIX = 'seed:'

interface SeedJournal {
  version: string
}

export class SeedRunner {
  constructor(private readonly db: DbType) {}

  async runAll(seeders: ISeeder[]): Promise<void> {
    if (seeders.length === 0) return

    const journalKeys = seeders.map((s) => `${SEED_KEY_PREFIX}${s.name}`)
    const journalMap = await this.loadJournals(journalKeys)

    for (const seeder of seeders) {
      const key = `${SEED_KEY_PREFIX}${seeder.name}`
      const journal = journalMap.get(key)

      if (journal?.version === seeder.version) {
        logger.debug(`Skipping seed "${seeder.name}" (v${seeder.version}) - already applied`)
        continue
      }

      await seeder.run(this.db)

      await this.db
        .insert(appStateTable)
        .values({
          key,
          value: { version: seeder.version }
        })
        .onConflictDoUpdate({
          target: appStateTable.key,
          set: {
            value: { version: seeder.version },
            updatedAt: Date.now()
          }
        })

      logger.info(`Seed "${seeder.name}" applied (v${seeder.version}) - ${seeder.description}`)
    }
  }

  private async loadJournals(keys: string[]): Promise<Map<string, SeedJournal>> {
    const rows = await this.db
      .select({ key: appStateTable.key, value: appStateTable.value })
      .from(appStateTable)
      .where(inArray(appStateTable.key, keys))

    const map = new Map<string, SeedJournal>()
    for (const row of rows) {
      map.set(row.key, row.value as SeedJournal)
    }
    return map
  }
}
