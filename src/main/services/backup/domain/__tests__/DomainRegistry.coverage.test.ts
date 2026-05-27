import path from 'node:path'

import { BackupDomain } from '@shared/backup'
import { getTableName, isTable } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { ALWAYS_STRIP_TABLES, DOMAIN_TABLE_MAP, INFRASTRUCTURE_TABLES } from '../DomainRegistry'

async function collectDrizzleSchemaTables(): Promise<string[]> {
  const schemasDir = path.resolve(import.meta.dirname, '../../../../data/db/schemas')
  const entries = await import.meta.glob('../../../../data/db/schemas/*.ts', { eager: true })
  const tableNames = new Set<string>()

  for (const [modulePath, mod] of Object.entries(entries)) {
    if (modulePath.endsWith('/README.md') || modulePath.endsWith('/_columnHelpers.ts')) {
      continue
    }

    for (const value of Object.values(mod as Record<string, unknown>)) {
      if (isTable(value)) {
        tableNames.add(getTableName(value))
      }
    }
  }

  expect(tableNames.size, `No schema tables discovered under ${schemasDir}`).toBeGreaterThan(0)
  return [...tableNames].sort()
}

describe('DomainRegistry coverage guard', () => {
  const domainTables = Object.values(DOMAIN_TABLE_MAP).flat()
  const classifiedTables = new Set([...domainTables, ...INFRASTRUCTURE_TABLES, ...ALWAYS_STRIP_TABLES])

  it('every Drizzle schema table is classified', async () => {
    const drizzleSchemaTables = await collectDrizzleSchemaTables()
    const unclassified = drizzleSchemaTables.filter((t) => !classifiedTables.has(t))
    expect(unclassified, `Unclassified tables: ${unclassified.join(', ')}`).toEqual([])
  })

  it('no table is classified more than once', async () => {
    const drizzleSchemaTables = await collectDrizzleSchemaTables()
    const seen = new Map<string, string[]>()
    for (const [domain, tables] of Object.entries(DOMAIN_TABLE_MAP)) {
      for (const table of tables) {
        const sources = seen.get(table) ?? []
        sources.push(`DOMAIN_TABLE_MAP.${domain}`)
        seen.set(table, sources)
      }
    }
    for (const table of INFRASTRUCTURE_TABLES) {
      const sources = seen.get(table) ?? []
      sources.push('INFRASTRUCTURE_TABLES')
      seen.set(table, sources)
    }
    for (const table of ALWAYS_STRIP_TABLES) {
      const sources = seen.get(table) ?? []
      sources.push('ALWAYS_STRIP_TABLES')
      seen.set(table, sources)
    }

    const duplicates = [...seen.entries()].filter(
      ([table, sources]) => drizzleSchemaTables.includes(table) && sources.length > 1
    )
    expect(duplicates, `Duplicate classifications: ${JSON.stringify(duplicates)}`).toEqual([])
  })

  it('DOMAIN_TABLE_MAP covers all BackupDomain values', () => {
    const allDomains = Object.values(BackupDomain)
    for (const domain of allDomains) {
      expect(DOMAIN_TABLE_MAP).toHaveProperty(domain)
    }
  })

  it('classified tables match the Drizzle schema table set exactly', async () => {
    const drizzleSchemaTables = await collectDrizzleSchemaTables()
    const classifiedDrizzleTables = [...classifiedTables]
      .filter((table) => !INFRASTRUCTURE_TABLES.includes(table as never) && table !== 'message_fts')
      .sort()
    expect(classifiedDrizzleTables).toEqual(drizzleSchemaTables)
  })

  it('no duplicate table names across domains', () => {
    const allTables = domainTables
    const unique = new Set(allTables)
    expect(allTables.length, 'Duplicate tables found across domains').toBe(unique.size)
  })
})
