import { appStateTable } from '@data/db/schemas/appState'
import type { DbType, ISeeder } from '@data/db/types'
import { loggerService } from '@logger'
import { eq, inArray } from 'drizzle-orm'

const logger = loggerService.withContext('SeedRunner')

const SEED_KEY_PREFIX = 'seed:'
/** Set after the first fully-successful seeding pass; while absent, the database is in its bootstrap window. */
const BOOTSTRAP_MARKER_KEY = 'seedRunner:bootstrapCompleted'

interface SeedJournal {
  version: string
}

export class SeedRunner {
  constructor(private readonly db: DbType) {}

  async runAll(seeders: ISeeder[]): Promise<void> {
    if (seeders.length === 0) return

    const journalKeys = seeders.map((s) => `${SEED_KEY_PREFIX}${s.name}`)
    const journalMap = await this.loadJournals(journalKeys)
    const bootstrapCompleted = await this.hasBootstrapCompleted()

    for (const seeder of seeders) {
      if (seeder.executionPolicy === 'bootstrap-only' && bootstrapCompleted) {
        logger.debug(`Skipping seed "${seeder.name}" (bootstrap-only) - bootstrap window closed`)
        continue
      }

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

    if (!bootstrapCompleted) {
      await this.markBootstrapCompleted()
    }
  }

  private async hasBootstrapCompleted(): Promise<boolean> {
    const [row] = await this.db
      .select({ key: appStateTable.key })
      .from(appStateTable)
      .where(eq(appStateTable.key, BOOTSTRAP_MARKER_KEY))
      .limit(1)
    return row !== undefined
  }

  private async markBootstrapCompleted(): Promise<void> {
    await this.db
      .insert(appStateTable)
      .values({
        key: BOOTSTRAP_MARKER_KEY,
        value: { completedAt: Date.now() },
        description: 'Set after the first fully-successful seeding pass; bootstrap-only seeders never run once present'
      })
      .onConflictDoNothing()
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
