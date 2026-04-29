import * as fs from 'node:fs'
import * as os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { createClient } from '@libsql/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@main/utils/file', () => ({
  sanitizeFilename: (value: string) => value
}))

vi.mock('node:fs', async (importOriginal) => {
  return (await importOriginal()) as any
})

vi.mock('node:os', async (importOriginal) => {
  return (await importOriginal()) as any
})

const { KnowledgeVectorSourceReader } = await import('../KnowledgeVectorSourceReader')

async function createLegacyVectorDb(
  dbPath: string,
  rows: Array<{
    id: string
    pageContent: string
    uniqueLoaderId: string
    source: string
    vector: number[]
  }>
) {
  const client = createClient({ url: pathToFileURL(dbPath).toString() })

  await client.execute(`
    CREATE TABLE vectors (
      id TEXT PRIMARY KEY,
      pageContent TEXT UNIQUE,
      uniqueLoaderId TEXT NOT NULL,
      source TEXT NOT NULL,
      vector F32_BLOB(2),
      metadata TEXT
    )
  `)

  for (const row of rows) {
    await client.execute({
      sql: `
        INSERT INTO vectors (id, pageContent, uniqueLoaderId, source, vector, metadata)
        VALUES (?, ?, ?, ?, vector32(?), '{}')
      `,
      args: [row.id, row.pageContent, row.uniqueLoaderId, row.source, `[${row.vector.join(',')}]`]
    })
  }

  client.close()
}

describe('KnowledgeVectorSourceReader', () => {
  let tempRoot: string

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'knowledge-vector-source-reader-'))
    fs.mkdirSync(path.join(tempRoot, 'KnowledgeBase'), { recursive: true })
  })

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true })
  })

  it('loads legacy embedjs rows from the knowledge base path', async () => {
    const reader = new KnowledgeVectorSourceReader(path.join(tempRoot, 'KnowledgeBase'))
    const dbPath = path.join(tempRoot, 'KnowledgeBase', 'kb-1')

    await createLegacyVectorDb(dbPath, [
      {
        id: 'legacy-row-1',
        pageContent: 'hello vector',
        uniqueLoaderId: 'loader-1',
        source: '/tmp/file.md',
        vector: [1, 2]
      }
    ])

    await expect(reader.loadBase('kb-1')).resolves.toEqual({
      status: 'ok',
      dbPath,
      rows: [
        {
          pageContent: 'hello vector',
          uniqueLoaderId: 'loader-1',
          source: '/tmp/file.md',
          vector: [1, 2]
        }
      ]
    })
  })

  it('returns not_embedjs for non-embedjs sqlite files', async () => {
    const reader = new KnowledgeVectorSourceReader(path.join(tempRoot, 'KnowledgeBase'))
    const dbPath = path.join(tempRoot, 'KnowledgeBase', 'kb-1')
    const client = createClient({ url: pathToFileURL(dbPath).toString() })

    await client.execute(`CREATE TABLE something_else (id TEXT PRIMARY KEY)`)
    client.close()

    await expect(reader.loadBase('kb-1')).resolves.toEqual({
      status: 'not_embedjs',
      dbPath
    })
  })
})
