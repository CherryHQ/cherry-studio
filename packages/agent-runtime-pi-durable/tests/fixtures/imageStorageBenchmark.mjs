import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { pathToFileURL } from 'node:url'

import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'

const root = resolve(process.argv[2] ?? 'node_modules/@earendil-works/pi-durable')
const { createSession } = await import(pathToFileURL(join(root, 'dist/index.js')).href)
const { openNodeSqliteStorage } = await import(pathToFileURL(join(root, 'dist/storage/sqlite/node.js')).href)
const directory = await mkdtemp(join(tmpdir(), 'durable-images-bench-'))
const file = join(directory, 'store.sqlite')
async function size(path) {
  return stat(path).then(
    (value) => value.size,
    (error) => {
      if (error.code === 'ENOENT') return 0
      throw error
    }
  )
}
try {
  const storage = await openNodeSqliteStorage(file)
  const session = createSession(storage)
  const images = Array.from({ length: 4 }, (_, index) => ({
    type: 'image',
    mimeType: 'image/png',
    data: Buffer.alloc(256 * 1024, index + 1).toString('base64')
  }))
  const conversation = await session.commit(
    (tx) => tx.createConversation({ ownership: { kind: 'ownerless' } }),
    BACKGROUND_CONTEXT
  )
  const start = performance.now()
  for (let i = 0; i < 64; i++) {
    await session.commit(
      (tx) => tx.appendEntry(conversation.id, { kind: 'synthetic-image', data: images[i % images.length] }),
      BACKGROUND_CONTEXT
    )
  }
  const writeMs = performance.now() - start
  const readStart = performance.now()
  let cursor
  let count = 0
  do {
    const page = await storage.scanEntries(
      { conversationId: conversation.id, order: 'ascending' },
      8,
      cursor,
      BACKGROUND_CONTEXT
    )
    for (const entry of page.items) {
      if (JSON.stringify(entry.data) !== JSON.stringify(images[count % images.length]))
        throw new Error('Image round-trip failed')
      count++
    }
    cursor = page.next
  } while (cursor)
  if (count !== 64) throw new Error('Incomplete history')
  const readMs = performance.now() - readStart
  const live = { databaseBytes: await size(file), walBytes: await size(`${file}-wal`) }
  await session.close(BACKGROUND_CONTEXT)
  const database = new DatabaseSync(file)
  const version = database.prepare('SELECT version FROM durable_schema').get().version
  const resources =
    version === 3
      ? database.prepare('SELECT count(*) AS count, sum(length(bytes)) AS bytes FROM image_blobs').get()
      : null
  database.close()
  process.stdout.write(
    `${JSON.stringify({ version, records: count, syntheticPayloadBytes: 256 * 1024, uniquePayloads: 4, resources, live, closed: { databaseBytes: await size(file), walBytes: await size(`${file}-wal`) }, writeMs, readMs, peakRssKb: process.resourceUsage().maxRSS })}\n`
  )
} finally {
  await rm(directory, { recursive: true, force: true })
}
