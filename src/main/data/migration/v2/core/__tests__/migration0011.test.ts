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

async function getRowCount(client: Client, tableName: string): Promise<number> {
  const result = await client.execute(`SELECT COUNT(*) AS count FROM ${tableName}`)
  return Number(result.rows[0].count)
}

async function getForeignKeyCheckRows(client: Client) {
  const result = await client.execute('PRAGMA foreign_key_check')
  return result.rows
}

describe('schema migrations', () => {
  let tempRoot: string
  let dbPath: string
  let client: Client

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(TEMP_ROOT, 'migration-0011-'))
    dbPath = path.join(tempRoot, 'migration.sqlite')
    client = createClient({ url: pathToFileURL(dbPath).href })
  })

  afterEach(async () => {
    client?.close()
    if (tempRoot) {
      await fs.rm(tempRoot, { recursive: true, force: true })
    }
  })

  it('migrates 0010 data to 0011, repairs orphan references, and preserves FK semantics', async () => {
    const db = drizzle({ client, casing: 'snake_case' })
    const migrations0010 = await createMigrationFolder(tempRoot, 10)
    const migrations0011 = await createMigrationFolder(tempRoot, 11)

    await migrate(db, { migrationsFolder: migrations0010 })

    await client.execute('PRAGMA foreign_keys = ON')

    await client.execute(`
      INSERT INTO user_provider (provider_id, name) VALUES
        ('openai', 'OpenAI'),
        ('cascade-provider', 'Cascade Provider')
    `)

    await client.execute(`
      INSERT INTO user_model (
        provider_id,
        model_id,
        preset_model_id,
        name,
        created_at,
        updated_at
      ) VALUES
        ('openai', 'chat-model', 'chat-model', 'Chat Model', 1, 1),
        ('openai', 'embed-model', 'embed-model', 'Embed Model', 1, 1),
        ('cascade-provider', 'cascade-model', 'cascade-model', 'Cascade Model', 1, 1)
    `)

    await client.execute(`
      INSERT INTO assistant (id, name, model_id, created_at, updated_at) VALUES
        ('ast-valid', 'Valid Assistant', 'openai::chat-model', 1, 1),
        ('ast-orphan', 'Orphan Assistant', 'raw-legacy-model', 1, 1)
    `)

    await client.execute(`
      INSERT INTO topic (id, name, created_at, updated_at) VALUES
        ('topic-1', 'Topic', 1, 1)
    `)

    await client.execute(`
      INSERT INTO message (
        id,
        parent_id,
        topic_id,
        role,
        data,
        searchable_text,
        status,
        siblings_group_id,
        model_id,
        model_snapshot,
        trace_id,
        stats,
        created_at,
        updated_at,
        deleted_at
      ) VALUES
        ('msg-valid', NULL, 'topic-1', 'assistant', '{"blocks":[]}', NULL, 'success', 0, 'openai::chat-model', NULL, NULL, NULL, 1, 1, NULL),
        ('msg-orphan', NULL, 'topic-1', 'assistant', '{"blocks":[]}', NULL, 'success', 0, 'gpt-4', NULL, NULL, NULL, 1, 1, NULL)
    `)

    await client.execute(`
      INSERT INTO knowledge_base (
        id,
        name,
        description,
        dimensions,
        embedding_model_id,
        rerank_model_id,
        created_at,
        updated_at
      ) VALUES
        ('kb-valid', 'Valid KB', NULL, 1536, 'openai::embed-model', 'openai::chat-model', 1, 1),
        ('kb-rerank-orphan', 'Rerank Orphan KB', NULL, 1536, 'openai::embed-model', 'legacy-rerank', 1, 1),
        ('kb-embedding-orphan', 'Embedding Orphan KB', NULL, 1536, 'legacy-embed', NULL, 1, 1)
    `)

    await migrate(db, { migrationsFolder: migrations0011 })
    await client.execute('PRAGMA foreign_keys = ON')

    expect(await getRowCount(client, 'user_model')).toBe(3)
    expect(await getRowCount(client, 'assistant')).toBe(2)
    expect(await getRowCount(client, 'message')).toBe(2)
    expect(await getRowCount(client, 'knowledge_base')).toBe(3)

    const userModels = await client.execute(
      'SELECT id, provider_id, model_id FROM user_model ORDER BY provider_id, model_id'
    )
    expect(userModels.rows).toEqual([
      { id: 'cascade-provider::cascade-model', provider_id: 'cascade-provider', model_id: 'cascade-model' },
      { id: 'openai::chat-model', provider_id: 'openai', model_id: 'chat-model' },
      { id: 'openai::embed-model', provider_id: 'openai', model_id: 'embed-model' }
    ])

    const assistants = await client.execute('SELECT id, model_id FROM assistant ORDER BY id')
    expect(assistants.rows).toEqual([
      { id: 'ast-orphan', model_id: null },
      { id: 'ast-valid', model_id: 'openai::chat-model' }
    ])

    const messages = await client.execute('SELECT id, model_id FROM message ORDER BY id')
    expect(messages.rows).toEqual([
      { id: 'msg-orphan', model_id: null },
      { id: 'msg-valid', model_id: 'openai::chat-model' }
    ])

    const knowledgeBases = await client.execute(
      'SELECT id, embedding_model_id, rerank_model_id FROM knowledge_base ORDER BY id'
    )
    expect(knowledgeBases.rows).toEqual([
      {
        id: 'kb-embedding-orphan',
        embedding_model_id: null,
        rerank_model_id: null
      },
      {
        id: 'kb-rerank-orphan',
        embedding_model_id: 'openai::embed-model',
        rerank_model_id: null
      },
      {
        id: 'kb-valid',
        embedding_model_id: 'openai::embed-model',
        rerank_model_id: 'openai::chat-model'
      }
    ])

    expect(await getForeignKeyCheckRows(client)).toEqual([])

    await client.execute("DELETE FROM user_model WHERE id = 'openai::embed-model'")
    await client.execute("DELETE FROM user_model WHERE id = 'openai::chat-model'")

    const afterDeleteAssistants = await client.execute('SELECT id, model_id FROM assistant ORDER BY id')
    expect(afterDeleteAssistants.rows).toEqual([
      { id: 'ast-orphan', model_id: null },
      { id: 'ast-valid', model_id: null }
    ])

    const afterDeleteMessages = await client.execute('SELECT id, model_id FROM message ORDER BY id')
    expect(afterDeleteMessages.rows).toEqual([
      { id: 'msg-orphan', model_id: null },
      { id: 'msg-valid', model_id: null }
    ])

    const afterDeleteKnowledgeBases = await client.execute(
      'SELECT id, embedding_model_id, rerank_model_id FROM knowledge_base ORDER BY id'
    )
    expect(afterDeleteKnowledgeBases.rows).toEqual([
      {
        id: 'kb-embedding-orphan',
        embedding_model_id: null,
        rerank_model_id: null
      },
      {
        id: 'kb-rerank-orphan',
        embedding_model_id: null,
        rerank_model_id: null
      },
      {
        id: 'kb-valid',
        embedding_model_id: null,
        rerank_model_id: null
      }
    ])

    await client.execute("DELETE FROM user_provider WHERE provider_id = 'cascade-provider'")

    const cascadeModels = await client.execute("SELECT id FROM user_model WHERE provider_id = 'cascade-provider'")
    expect(cascadeModels.rows).toEqual([])
    expect(await getForeignKeyCheckRows(client)).toEqual([])
  })

  it('backfills assistant order keys in createdAt order when migrating 0022 data to 0023', async () => {
    const db = drizzle({ client, casing: 'snake_case' })
    const migrations0022 = await createMigrationFolder(tempRoot, 22)
    const migrations0023 = await createMigrationFolder(tempRoot, 23)
    const sourceRows = Array.from({ length: 65 }, (_, index) => ({
      id: `ast-${String(65 - index).padStart(3, '0')}`,
      name: `Assistant ${index}`,
      createdAt: (index + 1) * 100
    }))

    await migrate(db, { migrationsFolder: migrations0022 })

    await client.execute(`
      INSERT INTO assistant (
        id,
        name,
        prompt,
        emoji,
        description,
        settings,
        created_at,
        updated_at,
        deleted_at
      ) VALUES
        ${sourceRows
          .map((row) => `('${row.id}', '${row.name}', '', ':)', '', '{}', ${row.createdAt}, ${row.createdAt}, NULL)`)
          .join(',\n')}
    `)

    await migrate(db, { migrationsFolder: migrations0023 })

    const assistants = await client.execute('SELECT id, order_key FROM assistant ORDER BY order_key, id')

    expect(assistants.rows.map((row) => row.id)).toEqual(sourceRows.map((row) => row.id))

    const orderKeys = assistants.rows.map((row) => String(row.order_key))
    expect(orderKeys.every((orderKey) => orderKey.length > 0)).toBe(true)
    expect(new Set(orderKeys).size).toBe(orderKeys.length)
    for (let i = 1; i < orderKeys.length; i++) {
      expect(orderKeys[i - 1] < orderKeys[i]).toBe(true)
    }
  })
})
