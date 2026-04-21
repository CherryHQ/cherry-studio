import { type Client, createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import { migrate } from 'drizzle-orm/libsql/migrator'
import fs from 'fs/promises'
import path from 'path'
import { pathToFileURL } from 'url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const SOURCE_MIGRATIONS_DIR = path.resolve(process.cwd(), 'migrations/sqlite-drizzle')
const TEMP_ROOT = process.env.TMPDIR || '/tmp'

async function createMigrationFolder(tempRoot: string, lastIndex: number): Promise<string> {
  const folder = path.join(tempRoot, `migrations-${lastIndex}`)
  const metaDir = path.join(folder, 'meta')

  await fs.mkdir(metaDir, { recursive: true })
  await fs.cp(path.join(SOURCE_MIGRATIONS_DIR, 'meta'), metaDir, { recursive: true })

  const journalPath = path.join(metaDir, '_journal.json')
  const journal = JSON.parse(await fs.readFile(journalPath, 'utf8')) as {
    dialect: string
    entries: Array<{ idx: number; tag: string; version: string; when: number; breakpoints: boolean }>
    version: string
  }

  const filteredEntries = journal.entries.filter((entry) => entry.idx <= lastIndex)
  await fs.writeFile(
    journalPath,
    JSON.stringify(
      {
        ...journal,
        entries: filteredEntries
      },
      null,
      2
    ) + '\n'
  )

  for (const entry of filteredEntries) {
    await fs.copyFile(path.join(SOURCE_MIGRATIONS_DIR, `${entry.tag}.sql`), path.join(folder, `${entry.tag}.sql`))
  }

  return folder
}

describe('migration 0013', () => {
  let tempRoot: string
  let dbPath: string
  let client: Client

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(TEMP_ROOT, 'migration-0013-'))
    dbPath = path.join(tempRoot, 'migration.sqlite')
    client = createClient({ url: pathToFileURL(dbPath).href })
  })

  afterEach(async () => {
    client?.close()
    if (tempRoot) {
      await fs.rm(tempRoot, { recursive: true, force: true })
    }
  })

  it('backfills repo-only skills.sh installs using folder_name for upgraded databases', async () => {
    const db = drizzle({ client, casing: 'snake_case' })
    const migrations0012 = await createMigrationFolder(tempRoot, 12)
    const migrations0013 = await createMigrationFolder(tempRoot, 13)

    await migrate(db, { migrationsFolder: migrations0012 })

    await client.execute(`
      INSERT INTO agent_global_skill (
        id,
        name,
        folder_name,
        source,
        source_url,
        content_hash,
        is_enabled,
        created_at,
        updated_at
      ) VALUES
        (
          'skill-monorepo',
          'Vercel React Best Practices',
          'vercel-react-best-practices',
          'marketplace',
          'https://github.com/vercel-labs/agent-skills',
          'hash-monorepo',
          0,
          1,
          1
        ),
        (
          'skill-repo-root',
          'Single Skill Repo',
          'single-skill-repo',
          'marketplace',
          'https://github.com/acme/single-skill-repo',
          'hash-root',
          0,
          1,
          1
        )
    `)

    await migrate(db, { migrationsFolder: migrations0013 })

    const result = await client.execute(`
      SELECT id, install_source, origin_key
      FROM agent_global_skill
      ORDER BY id
    `)

    expect(result.rows).toEqual([
      {
        id: 'skill-monorepo',
        install_source: 'skills.sh:vercel-labs/agent-skills/vercel-react-best-practices',
        origin_key: 'github:vercel-labs/agent-skills#vercel-react-best-practices'
      },
      {
        id: 'skill-repo-root',
        install_source: 'skills.sh:acme/single-skill-repo',
        origin_key: 'github:acme/single-skill-repo'
      }
    ])
  })
})
