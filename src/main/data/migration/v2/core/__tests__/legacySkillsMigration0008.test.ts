import { type Client, createClient } from '@libsql/client'
import fs from 'fs/promises'
import path from 'path'
import { pathToFileURL } from 'url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const MIGRATION_PATH = path.resolve(process.cwd(), 'resources/database/drizzle/0008_youthful_famine.sql')
const TEMP_ROOT = process.env.TMPDIR || '/tmp'

async function runMigration(client: Client): Promise<void> {
  const migrationSql = await fs.readFile(MIGRATION_PATH, 'utf8')
  const statements = migrationSql
    .split('--> statement-breakpoint')
    .map((statement) => statement.trim())
    .filter(Boolean)

  for (const statement of statements) {
    await client.execute(statement)
  }
}

describe('legacy skills migration 0008', () => {
  let tempRoot: string
  let client: Client

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(TEMP_ROOT, 'legacy-skills-0008-'))
    client = createClient({ url: pathToFileURL(path.join(tempRoot, 'agents.sqlite')).href })

    await client.execute(`
      CREATE TABLE skills (
        id text PRIMARY KEY NOT NULL,
        folder_name text NOT NULL,
        source text NOT NULL,
        source_url text
      )
    `)
  })

  afterEach(async () => {
    client?.close()
    if (tempRoot) {
      await fs.rm(tempRoot, { recursive: true, force: true })
    }
  })

  it('backfills repo-only skills.sh installs using folder_name for monorepo skills', async () => {
    await client.execute(`
      INSERT INTO skills (id, folder_name, source, source_url)
      VALUES
        (
          'skill-monorepo',
          'vercel-react-best-practices',
          'marketplace',
          'https://github.com/vercel-labs/agent-skills'
        ),
        (
          'skill-repo-root',
          'single-skill-repo',
          'marketplace',
          'https://github.com/acme/single-skill-repo'
        )
    `)

    await runMigration(client)

    const result = await client.execute('SELECT id, install_source, origin_key FROM skills ORDER BY id')
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
