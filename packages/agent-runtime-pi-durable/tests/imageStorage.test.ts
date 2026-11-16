import { fork } from 'node:child_process'
import { once } from 'node:events'
import { copyFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'

import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import { copyJson } from '@earendil-works/chord/json'
import type { DurableObjectSqliteStorage } from '@earendil-works/chord/sqlite/cloudflare'
import { createModels, fauxAssistantMessage, fauxProvider } from '@earendil-works/pi-ai'
import {
  Harness,
  createRegistry,
  createSession,
  defineDoc,
  MemoryStorage,
  type ConversationId,
  type EntryId,
  type TaskId,
  type SubmissionId,
  type StorageWrite
} from '@earendil-works/pi-durable'
import { applySqliteMigrations, SQLITE_MIGRATIONS, SqliteStorage } from '@earendil-works/pi-durable/storage/sqlite'
import { openDurableObjectSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/cloudflare'
import { NodeSqliteDatabase, openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node'
import { afterEach, expect, it } from 'vitest'

const context = BACKGROUND_CONTEXT
const image = { type: 'image', mimeType: 'image/png', data: Buffer.alloc(64 * 1024, 17).toString('base64') }
const directories: string[] = []

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'durable-images-'))
  directories.push(directory)
  const file = join(directory, 'store.sqlite')
  const storage = await openNodeSqliteStorage(file)
  const session = createSession(storage)
  return { file, storage, session }
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

it('deduplicates repeated images without changing historical or forked content after reopen', async () => {
  const { file, session } = await fixture()
  const { parent, entry } = await session.commit(async (tx) => {
    const parent = await tx.createConversation({ ownership: { kind: 'ownerless' } })
    const entry = await tx.appendEntry(parent.id, { kind: 'image-proof', data: [image, image] })
    return { parent, entry }
  }, context)
  const fork = await session.commit(
    (tx) => tx.forkConversation(parent.id, entry.id, { ownership: { kind: 'ownerless' } }),
    context
  )
  await session.commit(
    (tx) => tx.appendEntry(fork.id, { kind: 'image-proof', data: { ...image, mimeType: 'image/jpeg' } }),
    context
  )
  await session.close(context)
  const db = new DatabaseSync(file)
  try {
    expect(db.prepare('SELECT count(*) AS count, sum(length(bytes)) AS bytes FROM image_blobs').get()).toEqual({
      count: 1,
      bytes: 64 * 1024
    })
    expect(
      db
        .prepare('SELECT record FROM entries')
        .all()
        .every((row) => !String(row.record).includes(image.data))
    ).toBe(true)
  } finally {
    db.close()
  }
  const reopened = await openNodeSqliteStorage(file)
  try {
    expect((await reopened.entry(parent.id, entry.id, context))?.entry.data).toEqual([image, image])
    const history = await reopened.scanEntries({ conversationId: fork.id, order: 'ascending' }, 10, undefined, context)
    expect(history.items.map((item) => item.data)).toEqual([[image, image], { ...image, mimeType: 'image/jpeg' }])
  } finally {
    await reopened.close(context)
  }
})

it('reclaims replaced latest-document images while preserving arbitrary JSON and text', async () => {
  const { file, session } = await fixture()
  const doc = defineDoc({
    kind: 'image-proof',
    version: 1,
    scope: 'session',
    checkpointWhen: () => false,
    initial: () => ({ picture: image, text: image.data, lookalike: { hash: 'abc', path: ['picture', 'data'] } })
  })
  await session.commit(async (tx) => {
    await tx.doc(doc)
  }, context)
  await session.commit(async (tx) => {
    ;(await tx.doc(doc)).picture.data = 'AA=='
  }, context)
  const value = await session.commit(async (tx) => copyJson(await tx.doc(doc)), context)
  expect(value).toEqual({
    picture: { ...image, data: 'AA==' },
    text: image.data,
    lookalike: { hash: 'abc', path: ['picture', 'data'] }
  })
  await session.close(context)
  const db = new DatabaseSync(file)
  try {
    expect(db.prepare('SELECT sum(length(bytes)) AS bytes FROM image_blobs').get()).toEqual({ bytes: 1 })
  } finally {
    db.close()
  }
})

it('round-trips task and submission payloads, rejects a later batch and reclaims only the last reference', async () => {
  const { file, storage, session } = await fixture()
  const conversationId = await storage.mintId<ConversationId>()
  const taskId = await storage.mintId<TaskId<null>>()
  const submissionId = await storage.mintId<SubmissionId>()
  const task = {
    id: taskId,
    conversationId,
    kind: 'image-proof',
    version: 1,
    input: image,
    background: false,
    abortRequested: false,
    state: { status: 'pending' as const, checkpoint: { phase: 'ready', image } }
  }
  const submission = {
    id: submissionId,
    conversationId,
    type: 'input' as const,
    status: 'unanswered' as const,
    reason: 'test',
    detail: image,
    requestId: 'image-request'
  }
  const writes: StorageWrite[] = [
    { type: 'conversation', value: { id: conversationId } },
    { type: 'task', value: task },
    { type: 'submission', value: submission }
  ]
  const result = await storage.commit(
    [writes, [{ type: 'conversation', value: { id: conversationId } }]],
    () => {},
    context
  )
  expect(result.stored).toBe(1)
  expect(result.refused).toBeDefined()
  expect(await storage.task(taskId, context)).toEqual(task)
  expect((await storage.scanTasks({}, 1, undefined, context)).items).toEqual([task])
  expect(await storage.submissionByRequest(conversationId, 'image-request', context)).toEqual(submission)
  expect((await storage.scanSubmissions({}, 1, undefined, context)).items).toEqual([submission])
  const db = new DatabaseSync(file)
  try {
    await storage.commit(
      [
        [
          {
            type: 'task',
            value: {
              ...task,
              input: null,
              state: { status: 'terminal', outcome: { status: 'completed', result: null } }
            }
          }
        ]
      ],
      () => {},
      context
    )
    expect(db.prepare('SELECT count(*) AS count FROM image_blobs').get()).toEqual({ count: 1 })
    await storage.commit([[{ type: 'submission', value: { ...submission, detail: null } }]], () => {}, context)
    expect(db.prepare('SELECT count(*) AS count FROM image_blobs').get()).toEqual({ count: 0 })
  } finally {
    db.close()
    await session.close(context)
  }
})

it('rolls image writes back on SQL failure and reports damaged resources instead of empty content', async () => {
  const { file, storage, session } = await fixture()
  const conversationId = await storage.mintId<ConversationId>()
  const entryId = await storage.mintId<EntryId>()
  await storage.commit([[{ type: 'conversation', value: { id: conversationId } }]], () => {}, context)
  const db = new DatabaseSync(file)
  const writes: StorageWrite[] = [
    { type: 'entry', value: { id: entryId, conversationId, kind: 'image-proof', data: image } }
  ]
  try {
    db.exec(
      "CREATE TRIGGER fail_image_entry BEFORE INSERT ON entries BEGIN SELECT RAISE(ABORT, 'injected failure'); END"
    )
    await expect(storage.commit([writes], () => {}, context)).rejects.toThrow('injected failure')
    expect(db.prepare('SELECT count(*) AS count FROM image_blobs').get()).toEqual({ count: 0 })
    expect(await storage.entry(entryId, context)).toBeUndefined()
    db.exec('DROP TRIGGER fail_image_entry')
    await storage.commit([writes], () => {}, context)
    db.exec("UPDATE image_blobs SET bytes = x'00'")
    await expect(storage.entry(entryId, context)).rejects.toThrow('corrupt')
    db.exec('DELETE FROM image_blobs')
    await expect(storage.entry(entryId, context)).rejects.toThrow('missing')
  } finally {
    db.close()
    await session.close(context)
  }
})

it('restores a self-contained checkpointed backup and transfers hydrated history to another storage', async () => {
  const { file, session } = await fixture()
  const { parent, entry } = await session.commit(async (tx) => {
    const parent = await tx.createConversation({ ownership: { kind: 'ownerless' } })
    const entry = await tx.appendEntry(parent.id, { kind: 'image-proof', data: image })
    return { parent, entry }
  }, context)
  const forked = await session.commit(
    (tx) => tx.forkConversation(parent.id, entry.id, { ownership: { kind: 'ownerless' } }),
    context
  )
  const childEntry = await session.commit(
    (tx) => tx.appendEntry(forked.id, { kind: 'fork-image', data: { ...image, mimeType: 'image/jpeg' } }),
    context
  )
  await session.close(context)
  const restoredFile = join(directories[directories.length - 1], 'restored.sqlite')
  await copyFile(file, restoredFile)
  await rm(file)
  const restored = await openNodeSqliteStorage(restoredFile)
  const memory = new MemoryStorage()
  try {
    const history = await restored.scanEntries({ conversationId: parent.id }, 1, undefined, context)
    expect(history.items).toEqual([entry])
    expect(
      (await restored.scanEntries({ conversationId: forked.id, order: 'ascending' }, 10, undefined, context)).items
    ).toEqual([entry, childEntry])
    await memory.commit(
      [[{ type: 'conversation', value: parent }, ...history.items.map((value) => ({ type: 'entry' as const, value }))]],
      () => {},
      context
    )
    expect((await memory.entry(entry.id, context))?.entry.data).toEqual(image)
  } finally {
    await restored.close(context)
    await memory.close(context)
  }
})

it('converts legacy inline records and image-data deltas without changing IDs or commit sequences', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'durable-images-legacy-'))
  directories.push(directory)
  const file = join(directory, 'store.sqlite')
  const database = new NodeSqliteDatabase(new DatabaseSync(file))
  await applySqliteMigrations(database, SQLITE_MIGRATIONS.slice(0, 2))
  const legacy = await SqliteStorage.openExisting(database)
  const conversationId = await legacy.mintId<ConversationId>()
  const entryId = await legacy.mintId<EntryId>()
  const record = { id: entryId, conversationId, kind: 'image-proof', data: image }
  await database.run(
    'INSERT INTO conversations (id, record) VALUES (?, ?)',
    conversationId,
    JSON.stringify({ id: conversationId })
  )
  for (let id = 10; id < 42; id++)
    await database.run(
      'INSERT INTO entries (id, conversation_id, commit_seq, record) VALUES (?, ?, ?, ?)',
      id,
      conversationId,
      id,
      JSON.stringify({ ...record, id })
    )
  const doc = {
    id: 50,
    kind: 'image-document',
    scope: { kind: 'conversation', conversationId },
    history: 'rewindable',
    fork: 'asOf',
    createdAt: 1
  }
  await database.run(
    'INSERT INTO documents (id, kind, family, key_value, scope_kind, owner_id, created_at, record) VALUES (50, ?, 0, ?, ?, ?, 1, ?)',
    JSON.stringify(doc.kind),
    JSON.stringify(''),
    'conversation',
    conversationId,
    JSON.stringify(doc)
  )
  await database.run("INSERT INTO document_revisions VALUES (50, 1, 'base', 1, ?)", JSON.stringify({ picture: image }))
  await database.run(
    "INSERT INTO document_revisions VALUES (50, 2, 'delta', 1, ?)",
    JSON.stringify([['s', ['picture', 'data'], 'AA==']])
  )
  const before = await legacy.scanEntries({ conversationId, order: 'ascending' }, 40, undefined, context)
  await database.exec(
    "CREATE TRIGGER fail_conversion BEFORE UPDATE OF image_refs ON entries WHEN NEW.id = 26 BEGIN SELECT RAISE(ABORT, 'interrupted conversion'); END"
  )
  await expect(legacy.migrateImages()).rejects.toThrow('interrupted conversion')
  expect(await database.get('SELECT count(*) AS count FROM entries WHERE image_refs IS NOT NULL')).toEqual({
    count: 16
  })
  await database.exec('DROP TRIGGER fail_conversion')
  await legacy.migrateImages()
  expect(await legacy.scanEntries({ conversationId, order: 'ascending' }, 40, undefined, context)).toEqual(before)
  expect(await database.get('SELECT version FROM durable_schema')).toEqual({ version: 3 })
  await expect(applySqliteMigrations(database, SQLITE_MIGRATIONS.slice(0, 2))).rejects.toThrow('newer than supported')
  expect(await database.get('SELECT count(*) AS count FROM entries WHERE image_refs IS NULL')).toEqual({ count: 0 })
  const migratedDoc = await legacy.findDocument(
    { kind: doc.kind, scope: { kind: 'conversation', conversationId } },
    'current',
    context
  )
  expect((await legacy.document(migratedDoc!.id, 'current', context))?.value).toEqual({
    picture: { ...image, data: 'AA==' }
  })
  expect(await database.get('SELECT commit_seq FROM entries WHERE id = 10')).toEqual({ commit_seq: 10 })
  await legacy.close(context)
  const reopened = await openNodeSqliteStorage(file)
  try {
    expect(await reopened.scanEntries({ conversationId, order: 'ascending' }, 40, undefined, context)).toEqual(before)
    expect(
      (
        await reopened.findDocument(
          { kind: doc.kind, scope: { kind: 'conversation', conversationId } },
          'current',
          context
        )
      )?.id
    ).toBe(50)
  } finally {
    await reopened.close(context)
  }
})

it('preserves noncanonical encodings and reference-shaped user data in paginated reads', async () => {
  const { session, storage } = await fixture()
  const unusual = { ...image, data: ' AB==\n' }
  const lookalike = { image_refs: [{ path: ['data'], hash: 'a'.repeat(64) }], data: null, text: image.data }
  const parent = await session.commit((tx) => tx.createConversation({ ownership: { kind: 'ownerless' } }), context)
  await session.commit(async (tx) => {
    await tx.appendEntry(parent.id, { kind: 'image-proof', data: [unusual, lookalike] })
    await tx.appendEntry(parent.id, { kind: 'image-proof', data: image })
  }, context)
  try {
    const first = await storage.scanEntries({ conversationId: parent.id, order: 'ascending' }, 1, undefined, context)
    expect(first.items.map((entry) => entry.data)).toEqual([[unusual, lookalike]])
    const second = await storage.scanEntries({ conversationId: parent.id, order: 'ascending' }, 1, first.next, context)
    expect(second.items.map((entry) => entry.data)).toEqual([image])
  } finally {
    await session.close(context)
  }
})

it('retains rewindable document images through data-only deltas and fork copies', async () => {
  const { session, storage, file } = await fixture()
  const definition = defineDoc({
    kind: 'rewind-images',
    scope: 'conversation',
    version: 1,
    history: 'rewindable',
    fork: 'asOf',
    checkpointWhen: () => false,
    initial: () => ({ picture: image })
  })
  const parent = await session.commit((tx) => tx.createConversation({ ownership: { kind: 'ownerless' } }), context)
  const boundary = await session.commit(async (tx) => {
    await tx.doc(definition, parent.id)
    return tx.appendEntry(parent.id, { kind: 'boundary' })
  }, context)
  await session.commit(async (tx) => {
    ;(await tx.doc(definition, parent.id)).picture.data = 'AA=='
  }, context)
  const fork = await session.commit(
    (tx) => tx.forkConversation(parent.id, boundary.id, { ownership: { kind: 'ownerless' } }),
    context
  )
  try {
    expect(await session.commit(async (tx) => copyJson(await tx.doc(definition, parent.id)), context)).toEqual({
      picture: { ...image, data: 'AA==' }
    })
    expect(await session.commit(async (tx) => copyJson(await tx.doc(definition, fork.id)), context)).toEqual({
      picture: image
    })
    const docs = await storage.scanDocuments(
      { scope: { kind: 'conversation', conversationId: parent.id }, at: 'current' },
      5,
      undefined,
      context
    )
    expect(docs.items).toHaveLength(1)
    const db = new DatabaseSync(file)
    try {
      expect(db.prepare('SELECT count(*) AS count FROM image_blobs').get()).toEqual({ count: 2 })
    } finally {
      db.close()
    }
  } finally {
    await session.close(context)
  }
})

it.each(['before', 'after'])('recovers after process death %s the image transaction commits', async (boundary) => {
  const directory = await mkdtemp(join(tmpdir(), 'durable-images-crash-'))
  directories.push(directory)
  const file = join(directory, 'store.sqlite')
  const child = fork(fileURLToPath(new URL('./fixtures/imageStorageCrash.mjs', import.meta.url)), [file, boundary], {
    execArgv: [],
    silent: true
  })
  let stderr = ''
  child.stderr?.on('data', (chunk) => {
    stderr += chunk
  })
  const exited = once(child, 'exit')
  try {
    await Promise.race([
      once(child, 'message', { signal: AbortSignal.timeout(4000) }),
      exited.then(() => {
        throw new Error(`Crash fixture exited before transaction boundary: ${stderr}`)
      })
    ])
  } finally {
    child.kill('SIGKILL')
    await exited
  }
  const storage = await openNodeSqliteStorage(file)
  try {
    const conversation = (await storage.scanConversations({}, 1, undefined, context)).items[0]
    const history = await storage.scanEntries({ conversationId: conversation.id }, 10, undefined, context)
    expect(history.items.map((entry) => entry.data)).toEqual(boundary === 'after' ? [image] : [])
    const db = new DatabaseSync(file)
    try {
      expect(db.prepare('SELECT count(*) AS count FROM image_blobs').get()).toEqual({
        count: boundary === 'after' ? 1 : 0
      })
    } finally {
      db.close()
    }
  } finally {
    await storage.close(context)
  }
})

it('round-trips binary resources through the Durable Object adapter and a prefixed schema', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'durable-images-cloud-binding-'))
  directories.push(directory)
  const db = new DatabaseSync(join(directory, 'store.sqlite'))
  const binding: DurableObjectSqliteStorage = {
    sql: {
      exec(query, ...bindings) {
        const result = db
          .prepare(query)
          .all(...bindings.map((value) => (value instanceof ArrayBuffer ? new Uint8Array(value) : value)))
        const rows = result.map((row) =>
          Object.fromEntries(
            Object.entries(row).map(([key, value]) => [
              key,
              value instanceof Uint8Array
                ? Uint8Array.from(value).buffer
                : typeof value === 'bigint'
                  ? Number(value)
                  : value
            ])
          )
        )
        const iterator = rows[Symbol.iterator]()
        return { next: () => iterator.next(), toArray: () => rows }
      }
    },
    async transaction(callback) {
      db.exec('BEGIN IMMEDIATE')
      try {
        const result = await callback()
        db.exec('COMMIT')
        return result
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
    }
  }
  const storage = await openDurableObjectSqliteStorage(binding, { prefix: 'proof_' })
  const session = createSession(storage)
  try {
    const parent = await session.commit((tx) => tx.createConversation({ ownership: { kind: 'ownerless' } }), context)
    const entry = await session.commit(
      (tx) => tx.appendEntry(parent.id, { kind: 'image-proof', data: [image, image] }),
      context
    )
    expect((await storage.entry(entry.id, context))?.entry).toEqual(entry)
    expect(db.prepare('SELECT count(*) AS count, sum(length(bytes)) AS bytes FROM proof_image_blobs').get()).toEqual({
      count: 1,
      bytes: 64 * 1024
    })
  } finally {
    await session.close(context)
    db.close()
  }
})

it('supplies original images to the model again after the native harness reopens', async () => {
  const { file, session } = await fixture()
  await session.close(context)
  const models = createModels()
  const faux = fauxProvider()
  models.setProvider(faux.provider)
  const seen: unknown[] = []
  faux.setResponses(
    Array.from({ length: 2 }, () => (request) => {
      seen.push(
        request.messages.flatMap((message) =>
          typeof message.content === 'string' ? [] : message.content.filter((part) => part.type === 'image')
        )
      )
      return fauxAssistantMessage('image received')
    })
  )
  const options = { models, registry: createRegistry() }
  const harness = await Harness.open(await openNodeSqliteStorage(file), options, context)
  const conversation = await harness.createConversation(
    { ownership: { kind: 'ownerless' }, agent: { model: { provider: 'faux', modelId: 'faux-1' } } },
    context
  )
  try {
    const input = await conversation.submit({ type: 'input', content: [{ ...image, type: 'image' }] }, context)
    expect((await input.wait(context)).status).toBe('done')
  } finally {
    await harness.close(context)
  }
  const restored = await Harness.open(await openNodeSqliteStorage(file), options, context)
  try {
    const reopened = await restored.conversation(conversation.id, context)
    const input = await reopened!.submit({ type: 'input', content: 'Describe the same image again' }, context)
    expect((await input.wait(context)).status).toBe('done')
    expect(seen).toEqual([[image], [image]])
  } finally {
    await restored.close(context)
  }
})
