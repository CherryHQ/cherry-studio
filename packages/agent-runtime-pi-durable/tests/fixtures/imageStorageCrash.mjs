import { DatabaseSync } from 'node:sqlite'

import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import { SqliteStorage } from '@earendil-works/pi-durable/storage/sqlite'
import { NodeSqliteDatabase } from '@earendil-works/pi-durable/storage/sqlite/node'

const [file, boundary] = process.argv.slice(2)
const database = new NodeSqliteDatabase(new DatabaseSync(file))
await database.exec('PRAGMA journal_mode = WAL')
const storage = await SqliteStorage.open(database)
const conversationId = await storage.mintId()
await storage.commit([[{ type: 'conversation', value: { id: conversationId } }]], () => {}, BACKGROUND_CONTEXT)
const transaction = database.transaction.bind(database)
async function stop() {
  const stopped = new Promise((resolve) => process.once('message', resolve))
  process.send('ready')
  await stopped
}
if (boundary === 'before') {
  database.transaction = (callback) =>
    transaction(async (tx) => {
      const result = await callback(tx)
      await stop()
      return result
    })
}
await storage.commit(
  [
    [
      {
        type: 'entry',
        value: {
          id: await storage.mintId(),
          conversationId,
          kind: 'image-proof',
          data: { type: 'image', mimeType: 'image/png', data: Buffer.alloc(64 * 1024, 17).toString('base64') }
        }
      }
    ]
  ],
  () => {},
  BACKGROUND_CONTEXT
)
await stop()
