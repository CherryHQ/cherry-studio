import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { createClient } from '@libsql/client'
import { afterEach, describe, expect, it } from 'vitest'

const migrationPath = path.resolve(process.cwd(), 'migrations/sqlite-drizzle/0005_optimal_callisto.sql')

const applySqlStatements = async (sql: string, client: ReturnType<typeof createClient>) => {
  const statements = sql
    .split('--> statement-breakpoint')
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0)

  for (const statement of statements) {
    await client.execute(statement)
  }
}

describe('knowledge_item schema', () => {
  const tempDirs: string[] = []
  const tempRoot = process.env.TMPDIR ?? '/tmp'

  afterEach(async () => {
    await Promise.all(
      tempDirs.map(async (dir) => {
        await fs.rm(dir, { recursive: true, force: true })
      })
    )
    tempDirs.length = 0
  })

  it('rejects a parentId that points to an item in another knowledge base', async () => {
    const tempDir = await fs.mkdtemp(path.join(tempRoot, 'knowledge-schema-'))
    tempDirs.push(tempDir)

    const dbPath = path.join(tempDir, 'knowledge.sqlite')
    const client = createClient({ url: pathToFileURL(dbPath).toString() })

    try {
      await client.execute('PRAGMA foreign_keys = ON')
      const migrationSql = await fs.readFile(migrationPath, 'utf8')
      await applySqlStatements(migrationSql, client)

      await client.execute(
        "INSERT INTO knowledge_base (id, name, dimensions, embedding_model_id) VALUES ('kb-a', 'A', 1024, 'provider::model')"
      )
      await client.execute(
        "INSERT INTO knowledge_base (id, name, dimensions, embedding_model_id) VALUES ('kb-b', 'B', 1024, 'provider::model')"
      )
      await client.execute(
        'INSERT INTO knowledge_item (id, base_id, parent_id, type, data, status) VALUES (\'dir-a\', \'kb-a\', NULL, \'directory\', \'{"kind":"container","path":"/tmp/a","recursive":true}\', \'idle\')'
      )

      await expect(
        client.execute(
          'INSERT INTO knowledge_item (id, base_id, parent_id, type, data, status) VALUES (\'child-b\', \'kb-b\', \'dir-a\', \'directory\', \'{"kind":"entry","groupId":"g1","groupName":"Docs","file":{"id":"f1","name":"a.txt","origin_name":"a.txt","path":"/tmp/a.txt","size":1,"ext":".txt","type":"text","created_at":"2026-03-25T00:00:00.000Z","count":1}}\', \'idle\')'
        )
      ).rejects.toThrow()
    } finally {
      client.close()
    }
  })

  it('creates a composite index for baseId + parentId + createdAt', async () => {
    const tempDir = await fs.mkdtemp(path.join(tempRoot, 'knowledge-schema-'))
    tempDirs.push(tempDir)

    const dbPath = path.join(tempDir, 'knowledge.sqlite')
    const client = createClient({ url: pathToFileURL(dbPath).toString() })

    try {
      await client.execute('PRAGMA foreign_keys = ON')
      const migrationSql = await fs.readFile(migrationPath, 'utf8')
      await applySqlStatements(migrationSql, client)

      const indexListResult = await client.execute("PRAGMA index_list('knowledge_item')")
      const indexNames = indexListResult.rows.map((row: any) => row.name)

      expect(indexNames).toContain('knowledge_item_base_parent_created_idx')

      const indexInfoResult = await client.execute("PRAGMA index_info('knowledge_item_base_parent_created_idx')")
      expect(indexInfoResult.rows.map((row: any) => row.name)).toEqual(['base_id', 'parent_id', 'created_at'])
    } finally {
      client.close()
    }
  })
})
