import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import {
  createSession,
  StorageRequestError,
  type ConversationId,
  type EntryId,
  type Harness,
  type Session,
  type Tx
} from '@earendil-works/pi-durable'
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node'
import { v7 as uuid } from 'uuid'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { AgentSessionForkError } from '../fork'
import { forkDurable } from './durableFork'

describe('forkDurable checkpoint validation (real SQLite)', () => {
  let directory: string
  let session: Session
  const backendId = uuid()
  const targetCwd = '/tmp/fork-target'
  const artifactDirectory = '/tmp/fork-artifacts'

  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), 'cherry-durable-fork-'))
    const storage = await openNodeSqliteStorage(join(directory, 'store.sqlite'))
    session = createSession(storage)
  })

  afterEach(async () => {
    await session.close(BACKGROUND_CONTEXT)
    rmSync(directory, { recursive: true, force: true })
  })

  const checkpointOf = (conversationId: ConversationId, entryId: EntryId) => ({
    runtime: 'pi-durable' as const,
    backendId,
    conversationId: String(conversationId),
    entryId: String(entryId)
  })

  async function appendText(conversationId: ConversationId, text: string): Promise<EntryId> {
    const entry = await session.commit(
      (tx) =>
        tx.appendEntry(conversationId, {
          kind: 'pi.user',
          model: [{ role: 'user', content: text, timestamp: 1 }]
        }),
      BACKGROUND_CONTEXT
    )
    return entry.id
  }

  async function scanAllAscending(conversationId: ConversationId): Promise<EntryId[]> {
    return session.commit(async (tx) => {
      const ids: EntryId[] = []
      let cursor: Parameters<typeof tx.scanEntries>[2]
      do {
        const page = await tx.scanEntries({ conversationId, order: 'ascending' }, 256, cursor)
        for (const item of page.items) ids.push(item.id)
        cursor = page.next
      } while (cursor)
      return ids
    }, BACKGROUND_CONTEXT)
  }

  it('matches real SQLite scanEntries visibility across multilevel forks and validates resulting fork history', async () => {
    // Build multilevel fork tree in real SQLite:
    // C1: [e1, e2] -> fork C2@e2 & sibling C2b@e2 -> append e3 to C1, eSib to C2b
    // C2: [e4, e5] -> fork C3@e4 -> append e6 to C2
    // C3: [e7]
    const c1 = await session.commit(
      (tx) => tx.createConversation({ ownership: { kind: 'ownerless' } }),
      BACKGROUND_CONTEXT
    )
    const e1 = await appendText(c1.id, 'c1-1')
    const e2 = await appendText(c1.id, 'c1-2')
    const c2 = await session.commit(
      (tx) => tx.forkConversation(c1.id, e2, { ownership: { kind: 'ownerless' } }),
      BACKGROUND_CONTEXT
    )
    const c2b = await session.commit(
      (tx) => tx.forkConversation(c1.id, e2, { ownership: { kind: 'ownerless' } }),
      BACKGROUND_CONTEXT
    )
    const e3 = await appendText(c1.id, 'c1-post-fork')
    const eSib = await appendText(c2b.id, 'c2b-sibling')
    const e4 = await appendText(c2.id, 'c2-4')
    const e5 = await appendText(c2.id, 'c2-5')
    const c3 = await session.commit(
      (tx) => tx.forkConversation(c2.id, e4, { ownership: { kind: 'ownerless' } }),
      BACKGROUND_CONTEXT
    )
    const e6 = await appendText(c2.id, 'c2-post-fork')
    const e7 = await appendText(c3.id, 'c3-7')

    expect(await scanAllAscending(c3.id)).toEqual([e1, e2, e4, e7])

    // 1. Accepted: source-owned entry + all inherited ancestor entries
    const fullFork = await forkDurable(session, {
      sourceSessionId: 'src',
      sourceBackendId: backendId,
      checkpoint: checkpointOf(c3.id, e7),
      checkpoints: [checkpointOf(c3.id, e1), checkpointOf(c3.id, e2), checkpointOf(c3.id, e4), checkpointOf(c3.id, e7)],
      targetSessionId: uuid(),
      targetCwd,
      artifactDirectory,
      signal: new AbortController().signal
    })
    expect(await scanAllAscending(Number(fullFork.resumeToken) as ConversationId)).toEqual([e1, e2, e4, e7])

    // 2. Accepted: inherited fork boundary at C2 (e4) and C1 (e2)
    const atBoundaryC2 = await forkDurable(session, {
      sourceSessionId: 'src',
      sourceBackendId: backendId,
      checkpoint: checkpointOf(c3.id, e4),
      checkpoints: [checkpointOf(c3.id, e1), checkpointOf(c3.id, e2), checkpointOf(c3.id, e4)],
      targetSessionId: uuid(),
      targetCwd,
      artifactDirectory,
      signal: new AbortController().signal
    })
    expect(await scanAllAscending(Number(atBoundaryC2.resumeToken) as ConversationId)).toEqual([e1, e2, e4])

    const atBoundaryC1 = await forkDurable(session, {
      sourceSessionId: 'src',
      sourceBackendId: backendId,
      checkpoint: checkpointOf(c3.id, e2),
      checkpoints: [checkpointOf(c3.id, e1), checkpointOf(c3.id, e2)],
      targetSessionId: uuid(),
      targetCwd,
      artifactDirectory,
      signal: new AbortController().signal
    })
    expect(await scanAllAscending(Number(atBoundaryC1.resumeToken) as ConversationId)).toEqual([e1, e2])

    // 3. Accepted: duplicate checkpoints and empty checkpoints
    const duplicate = await forkDurable(session, {
      sourceSessionId: 'src',
      sourceBackendId: backendId,
      checkpoint: checkpointOf(c3.id, e4),
      checkpoints: [checkpointOf(c3.id, e2), checkpointOf(c3.id, e2), checkpointOf(c3.id, e4)],
      targetSessionId: uuid(),
      targetCwd,
      artifactDirectory,
      signal: new AbortController().signal
    })
    expect(duplicate.checkpoints).toHaveLength(3)
    expect(await scanAllAscending(Number(duplicate.resumeToken) as ConversationId)).toEqual([e1, e2, e4])

    const empty = await forkDurable(session, {
      sourceSessionId: 'src',
      sourceBackendId: backendId,
      checkpoint: checkpointOf(c3.id, e7),
      checkpoints: [],
      targetSessionId: uuid(),
      targetCwd,
      artifactDirectory,
      signal: new AbortController().signal
    })
    expect(empty.checkpoints).toEqual([])
    expect(await scanAllAscending(Number(empty.resumeToken) as ConversationId)).toEqual([e1, e2, e4, e7])

    // 4. Rejected with history_changed (aligning with real SQLite scanEntries):
    // missing entry, sibling branch, ancestor post-fork entries (e3, e5, e6), checkpoint > selected entry
    const missingEntryId = 999999 as EntryId
    const rejectedCases = [
      { label: 'missing selected entry', checkpoint: checkpointOf(c3.id, missingEntryId), checkpoints: [] },
      { label: 'sibling branch entry as selected', checkpoint: checkpointOf(c3.id, eSib), checkpoints: [] },
      { label: 'ancestor C1 post-fork entry e3', checkpoint: checkpointOf(c3.id, e3), checkpoints: [] },
      { label: 'ancestor C2 skipped entry e5', checkpoint: checkpointOf(c3.id, e5), checkpoints: [] },
      { label: 'ancestor C2 post-fork entry e6', checkpoint: checkpointOf(c3.id, e6), checkpoints: [] },
      {
        label: 'checkpoint after selected entry',
        checkpoint: checkpointOf(c3.id, e4),
        checkpoints: [checkpointOf(c3.id, e7)]
      },
      {
        label: 'ancestor post-fork entry in checkpoints',
        checkpoint: checkpointOf(c3.id, e7),
        checkpoints: [checkpointOf(c3.id, e1), checkpointOf(c3.id, e6)]
      },
      {
        label: 'sibling entry in checkpoints',
        checkpoint: checkpointOf(c3.id, e7),
        checkpoints: [checkpointOf(c3.id, eSib)]
      },
      {
        label: 'missing entry in checkpoints',
        checkpoint: checkpointOf(c3.id, e7),
        checkpoints: [checkpointOf(c3.id, missingEntryId)]
      }
    ]
    for (const item of rejectedCases) {
      const rejection = expect(
        forkDurable(session as unknown as Pick<Harness, 'commit'>, {
          sourceSessionId: 'src',
          sourceBackendId: backendId,
          checkpoint: item.checkpoint,
          checkpoints: item.checkpoints,
          targetSessionId: uuid(),
          targetCwd,
          artifactDirectory,
          signal: new AbortController().signal
        }),
        item.label
      ).rejects
      await rejection.toBeInstanceOf(AgentSessionForkError)
      await rejection.toMatchObject({ name: 'AgentSessionForkError', reason: 'history_changed' })
    }

    // 5. Missing source conversation preserves StorageRequestError("Unknown conversation: ...")
    const missingConversation = 999998 as ConversationId
    await expect(
      forkDurable(session as unknown as Pick<Harness, 'commit'>, {
        sourceSessionId: 'src',
        sourceBackendId: backendId,
        checkpoint: checkpointOf(missingConversation, e1),
        checkpoints: [],
        targetSessionId: uuid(),
        targetCwd,
        artifactDirectory,
        signal: new AbortController().signal
      })
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof StorageRequestError && error.message === `Unknown conversation: ${missingConversation}`
    )

    // 6. Preserved contract errors & idempotent/conflicting replay
    await expect(
      forkDurable(session as unknown as Pick<Harness, 'commit'>, {
        sourceSessionId: 'src',
        sourceBackendId: uuid(),
        checkpoint: checkpointOf(c3.id, e7),
        checkpoints: [],
        targetSessionId: uuid(),
        targetCwd,
        artifactDirectory,
        signal: new AbortController().signal
      })
    ).rejects.toMatchObject({ name: 'AgentSessionForkError', reason: 'unsupported_checkpoint' })

    await expect(
      forkDurable(session as unknown as Pick<Harness, 'commit'>, {
        sourceSessionId: 'src',
        sourceBackendId: backendId,
        checkpoint: checkpointOf(c3.id, e7),
        checkpoints: [checkpointOf(c2.id, e4)],
        targetSessionId: uuid(),
        targetCwd,
        artifactDirectory,
        signal: new AbortController().signal
      })
    ).rejects.toMatchObject({ name: 'AgentSessionForkError', reason: 'unsupported_checkpoint' })

    await expect(
      forkDurable(session as unknown as Pick<Harness, 'commit'>, {
        sourceSessionId: 'src',
        sourceBackendId: backendId,
        checkpoint: { ...checkpointOf(c3.id, e7), entryId: '0' },
        checkpoints: [],
        targetSessionId: uuid(),
        targetCwd,
        artifactDirectory,
        signal: new AbortController().signal
      })
    ).rejects.toThrow()

    const aborted = new AbortController()
    aborted.abort(new Error('cancelled fork'))
    await expect(
      forkDurable(session as unknown as Pick<Harness, 'commit'>, {
        sourceSessionId: 'src',
        sourceBackendId: backendId,
        checkpoint: checkpointOf(c3.id, e7),
        checkpoints: [],
        targetSessionId: uuid(),
        targetCwd,
        artifactDirectory,
        signal: aborted.signal
      })
    ).rejects.toThrow('cancelled fork')

    const replayTarget = uuid()
    const firstReplay = await forkDurable(session, {
      sourceSessionId: 'src',
      sourceBackendId: backendId,
      checkpoint: checkpointOf(c3.id, e4),
      checkpoints: [checkpointOf(c3.id, e4)],
      targetSessionId: replayTarget,
      targetCwd,
      artifactDirectory,
      signal: new AbortController().signal
    })
    const secondReplay = await forkDurable(session, {
      sourceSessionId: 'src',
      sourceBackendId: backendId,
      checkpoint: checkpointOf(c3.id, e4),
      checkpoints: [checkpointOf(c3.id, e4)],
      targetSessionId: replayTarget,
      targetCwd,
      artifactDirectory,
      signal: new AbortController().signal
    })
    expect(secondReplay.resumeToken).toBe(firstReplay.resumeToken)

    await expect(
      forkDurable(session as unknown as Pick<Harness, 'commit'>, {
        sourceSessionId: 'src',
        sourceBackendId: backendId,
        checkpoint: checkpointOf(c3.id, e7),
        checkpoints: [checkpointOf(c3.id, e7)],
        targetSessionId: replayTarget,
        targetCwd,
        artifactDirectory,
        signal: new AbortController().signal
      })
    ).rejects.toMatchObject({ name: 'AgentSessionForkError', reason: 'history_corrupt' })
  })

  it('rejects a missing ancestor even when the selected entry belongs to the source', async () => {
    const parent = await session.commit(
      (tx) => tx.createConversation({ ownership: { kind: 'ownerless' } }),
      BACKGROUND_CONTEXT
    )
    const entry = await appendText(parent.id, 'parent')
    const child = await session.commit(
      (tx) => tx.forkConversation(parent.id, entry, { ownership: { kind: 'ownerless' } }),
      BACKGROUND_CONTEXT
    )
    const childEntry = await appendText(child.id, 'child')
    const path = join(directory, 'store.sqlite')
    await session.close(BACKGROUND_CONTEXT)
    {
      using db = new DatabaseSync(path)
      db.prepare('DELETE FROM conversations WHERE id = ?').run(parent.id)
    }
    session = createSession(await openNodeSqliteStorage(path))

    await expect(
      forkDurable(session, {
        sourceSessionId: 'src',
        sourceBackendId: backendId,
        checkpoint: checkpointOf(child.id, childEntry),
        checkpoints: [],
        targetSessionId: uuid(),
        targetCwd,
        artifactDirectory,
        signal: new AbortController().signal
      })
    ).rejects.toSatisfy(
      (error: unknown) => error instanceof StorageRequestError && error.message === `Unknown conversation: ${parent.id}`
    )
  })

  it('keeps the earlier inherited fork boundary across multiple ancestors', async () => {
    const c1 = await session.commit(
      (tx) => tx.createConversation({ ownership: { kind: 'ownerless' } }),
      BACKGROUND_CONTEXT
    )
    const e1 = await appendText(c1.id, 'c1-1')
    const e2 = await appendText(c1.id, 'c1-2')
    const c2 = await session.commit(
      (tx) => tx.forkConversation(c1.id, e2, { ownership: { kind: 'ownerless' } }),
      BACKGROUND_CONTEXT
    )
    const c3 = await session.commit(
      (tx) => tx.forkConversation(c2.id, e1, { ownership: { kind: 'ownerless' } }),
      BACKGROUND_CONTEXT
    )
    const e3 = await appendText(c3.id, 'c3-1')
    expect(await scanAllAscending(c3.id)).toEqual([e1, e3])

    const input = {
      sourceSessionId: 'src',
      sourceBackendId: backendId,
      checkpoint: checkpointOf(c3.id, e3),
      targetSessionId: uuid(),
      targetCwd,
      artifactDirectory,
      signal: new AbortController().signal
    }
    const result = await forkDurable(session, { ...input, checkpoints: [checkpointOf(c3.id, e1)] })
    expect(await scanAllAscending(Number(result.resumeToken) as ConversationId)).toEqual([e1, e3])
    await expect(forkDurable(session, { ...input, checkpoints: [checkpointOf(c3.id, e2)] })).rejects.toMatchObject({
      name: 'AgentSessionForkError',
      reason: 'history_changed'
    })
  })

  it('validates > 256 entry history with bounded point lookups and zero tx.scanEntries calls', async () => {
    const conv = await session.commit(
      (tx) => tx.createConversation({ ownership: { kind: 'ownerless' } }),
      BACKGROUND_CONTEXT
    )
    const entryIds = await session.commit(async (tx) => {
      const ids: EntryId[] = []
      for (let i = 0; i < 300; i++) {
        const record = await tx.appendEntry(conv.id, {
          kind: 'pi.user',
          model: [{ role: 'user', content: `msg-${i}`, timestamp: 1 }]
        })
        ids.push(record.id)
      }
      return ids
    }, BACKGROUND_CONTEXT)

    const counts = { scanEntries: 0, entry: 0, conversation: 0 }
    const countingSession: Pick<Harness, 'commit'> = {
      commit: (change, ctx) =>
        session.commit(
          (tx: Tx) =>
            change(
              new Proxy(tx, {
                get(target, prop) {
                  const value = Reflect.get(target, prop)
                  if (typeof value !== 'function') return value
                  if (prop === 'scanEntries' || prop === 'entry' || prop === 'conversation') {
                    return (...args: unknown[]) => {
                      counts[prop]++
                      return value.apply(target, args)
                    }
                  }
                  return value.bind(target)
                }
              })
            ),
          ctx
        )
    }

    const tenth = entryIds[9]
    const last = entryIds[299]
    const result = await forkDurable(countingSession, {
      sourceSessionId: 'long-session',
      sourceBackendId: backendId,
      checkpoint: checkpointOf(conv.id, last),
      checkpoints: [checkpointOf(conv.id, tenth), checkpointOf(conv.id, last)],
      targetSessionId: uuid(),
      targetCwd,
      artifactDirectory,
      signal: new AbortController().signal
    })

    expect(counts.scanEntries).toBe(0)
    expect(counts.entry).toBe(2)
    expect(counts.conversation).toBe(1)
    expect(await scanAllAscending(Number(result.resumeToken) as ConversationId)).toEqual(entryIds)
  })
})
