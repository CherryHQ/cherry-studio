import { mkdtemp, readFile, readdir, rmdir, symlink, unlink, writeFile } from 'node:fs/promises'
import * as fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createMemoryBackup, MEMORY_BACKUP_BYTES } from '../memoryBackups'
import * as memoryBackups from '../memoryBackups'
import { entriesIn, type MemoryEntry, parseMemoryEntries, serializeMemoryEntries } from '../memoryEntries'
import * as memoryFiles from '../memoryFiles'
import { type MemoryAccess, type MemoryApproval, MemoryStore } from '../MemoryStore'

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof fs>()
  return { ...actual, lstat: vi.fn(actual.lstat), open: vi.fn(actual.open) }
})

const approve: MemoryApproval = async () => () => undefined
const access = (): MemoryAccess => ({ assertAuthorized: () => undefined })
let fixture: string
let root: string
let backups: string
let store: MemoryStore
let caller: MemoryAccess

async function removeFixtureFiles(directory: string): Promise<void> {
  if (directory !== fixture && !directory.startsWith(`${fixture}${path.sep}`)) throw new Error('Outside test fixture')
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name)
    if (entry.isDirectory() && !entry.isSymbolicLink()) await removeFixtureFiles(target)
    else await unlink(target)
  }
  await rmdir(directory)
}

beforeEach(async () => {
  fixture = await mkdtemp(path.join(os.tmpdir(), 'cherry-memory-'))
  root = path.join(fixture, 'Memory')
  backups = path.join(fixture, 'Backups')
  store = new MemoryStore(root, backups)
  caller = access()
  await store.initialize()
})

afterEach(async () => {
  vi.restoreAllMocks()
  vi.mocked(fs.lstat).mockReset()
  vi.mocked(fs.open).mockReset()
  await removeFixtureFiles(fixture)
})

async function save(target: string, content: string, owner = caller) {
  const read = await store.read(owner, target)
  return store.commit(owner, [{ kind: 'write', receipt: read.receipt, content }], 'controlled', approve)
}

describe('structured memory disk protection', () => {
  const entry: MemoryEntry = {
    schemaVersion: 1,
    id: 'entry-1',
    status: 'forgotten',
    sources: [{ kind: 'chat', conversationId: 'topic-1', messageId: 'message-1', sourceVersion: 'v1' }],
    text: '',
    derivedFrom: []
  }
  const encode = (value: MemoryEntry) => serializeMemoryEntries([value])

  it('refuses malformed metadata on read and leaves the original bytes intact', async () => {
    const broken = encode(entry).replace(':v1', ':v9')
    await writeFile(path.join(root, 'MEMORY.md'), broken)
    await expect(store.read(caller, 'MEMORY.md')).rejects.toMatchObject({ code: 'conflict' })
    await expect(store.entry(caller)).rejects.toMatchObject({ code: 'conflict' })
    expect(await readFile(path.join(root, 'MEMORY.md'), 'utf8')).toBe(broken)
  })

  it('does not accept new source metadata from a caller claiming to be extraction', async () => {
    const read = await store.read(caller, 'MEMORY.md')
    await expect(
      store.commit(
        caller,
        [{ kind: 'write', receipt: read.receipt, content: encode({ ...entry, status: 'active', text: 'Fact' }) }],
        'extraction',
        approve
      )
    ).rejects.toMatchObject({ code: 'conflict' })
    expect(await readFile(path.join(root, 'MEMORY.md'), 'utf8')).toBe('')
  })

  it.each(['remove', 'reactivate', 'new-id', 'new-version', 'forged-source'] as const)(
    'rejects ordinary %s without changing disk or creating a backup',
    async (attack) => {
      const original = encode(entry)
      await writeFile(path.join(root, 'MEMORY.md'), original)
      const read = await store.read(caller, 'MEMORY.md')
      const content =
        attack === 'remove'
          ? ''
          : encode({
              ...entry,
              status: 'active',
              text: 'Forgotten secret',
              id: attack === 'new-id' ? 'entry-2' : entry.id,
              sources: attack === 'new-version' ? [{ ...entry.sources[0], sourceVersion: 'v2' }] : entry.sources
            })
      await expect(
        store.commit(
          caller,
          [{ kind: 'write', receipt: read.receipt, content }],
          attack === 'forged-source' ? 'clear' : 'controlled',
          approve
        )
      ).rejects.toMatchObject({ code: 'conflict' })
      expect(await readFile(path.join(root, 'MEMORY.md'), 'utf8')).toBe(original)
      expect(await readdir(backups)).toEqual([])
    }
  )

  it('blocks recreating forbidden content in another file, including unstructured text', async () => {
    await writeFile(path.join(root, 'MEMORY.md'), encode(entry))
    for (const text of ['Forgotten secret', encode({ ...entry, id: 'another', status: 'active', text: 'Secret' })]) {
      await expect(save('.memories/recreated.md', text)).rejects.toMatchObject({ code: 'conflict' })
      await expect(readFile(path.join(root, '.memories/recreated.md'))).rejects.toMatchObject({ code: 'ENOENT' })
    }
  })

  it('clears bodies in entry and topic files, approves exact tombstones, and cannot recover old facts after restart', async () => {
    await writeFile(path.join(root, 'MEMORY.md'), encode({ ...entry, status: 'active', text: 'Secret address' }))
    await writeFile(
      path.join(root, '.memories/topic.md'),
      encode({ ...entry, id: 'unknown-source', sources: [], status: 'expired', text: 'Old fact' })
    )
    const preview = await store.previewClear(caller)
    const approved = new Map<string, string | null>()
    const result = await store.clear(caller, preview.token, async (changes) => {
      for (const change of changes) approved.set(change.path, change.content)
      return () => undefined
    })
    expect(result.error).toBeUndefined()
    for (const [target, content] of approved) {
      expect(await readFile(path.join(root, target), 'utf8')).toBe(content)
      const entries = entriesIn(parseMemoryEntries(content!))
      expect(entries).toHaveLength(1)
      expect(entries[0]).toMatchObject({ status: 'forgotten', text: '' })
    }
    store = new MemoryStore(root, backups)
    await store.initialize()
    const recovery = await store.previewRecovery(caller)
    expect((await store.recover(caller, recovery!.token, approve)).error).toBeUndefined()
    expect(await readFile(path.join(root, 'MEMORY.md'), 'utf8')).not.toContain('Secret address')
    expect(await readFile(path.join(root, '.memories/topic.md'), 'utf8')).not.toContain('Old fact')
    expect(entriesIn(parseMemoryEntries(await readFile(path.join(root, 'MEMORY.md'), 'utf8')))[0]).toEqual(entry)
  })

  it.each(['legacy', 'changed-version'] as const)('refuses unsafe %s recovery before approval', async (kind) => {
    const original =
      kind === 'legacy'
        ? 'Secret address'
        : encode({
            ...entry,
            id: 'other',
            status: 'active',
            text: 'Secret address',
            sources: [{ ...entry.sources[0], sourceVersion: 'v2' }]
          })
    const current = encode(entry)
    await writeFile(path.join(root, 'MEMORY.md'), current)
    await createMemoryBackup(
      backups,
      [{ path: 'MEMORY.md', before: Buffer.from(original), after: Buffer.from(current) }],
      'controlled'
    )
    const preview = await store.previewRecovery(caller)
    await expect(
      store.recover(caller, preview!.token, async () => {
        throw new Error('Must not approve unsafe content')
      })
    ).rejects.toMatchObject({ code: 'conflict' })
    expect(await readFile(path.join(root, 'MEMORY.md'), 'utf8')).toBe(current)
  })

  it('rechecks the entire scope under the lock after approval', async () => {
    const read = await store.read(caller, 'MEMORY.md')
    await expect(
      store.commit(caller, [{ kind: 'write', receipt: read.receipt, content: 'New text' }], 'controlled', async () => {
        await writeFile(path.join(root, '.memories/tombstone.md'), encode(entry))
        return () => undefined
      })
    ).rejects.toMatchObject({ code: 'conflict' })
    expect(await readFile(path.join(root, 'MEMORY.md'), 'utf8')).toBe('')
    expect(await readdir(backups)).toEqual([])
  })
})

describe('memory save contract', () => {
  it.each(['write', 'noop', 'clear'] as const)(
    'rejects %s invalidated during the final target identity check',
    async (operation) => {
      await save('MEMORY.md', 'Original')
      const read = await store.read(caller, 'MEMORY.md')
      const preview = await store.previewClear(caller)
      const previousBackups = await readdir(backups)
      let approved = false
      let invalidated = false
      const original = (await vi.importActual<typeof fs>('node:fs/promises')).lstat
      vi.mocked(fs.lstat).mockImplementation(async (...args) => {
        const result = await original(...args)
        if (approved && typeof args[1] === 'object' && args[1]?.bigint && !invalidated) {
          invalidated = true
          store.invalidate()
        }
        return result
      })
      const approval: MemoryApproval = async () => {
        approved = true
        return () => undefined
      }
      const pending =
        operation === 'clear'
          ? store.clear(caller, preview.token, approval)
          : store.commit(
              caller,
              [{ kind: 'write', receipt: read.receipt, content: operation === 'noop' ? 'Original' : 'Stale' }],
              'controlled',
              approval
            )
      await expect(pending).rejects.toMatchObject({ code: 'invalid-receipt' })
      expect(invalidated).toBe(true)
      expect(await readFile(path.join(root, 'MEMORY.md'), 'utf8')).toBe('Original')
      expect(await readdir(backups)).toEqual(previousBackups)
    }
  )

  it.each(['validation', 'backup'] as const)(
    'rejects recovery invalidated during %s without replacing current content',
    async (stage) => {
      await save('MEMORY.md', 'Before')
      await save('MEMORY.md', 'After')
      const preview = await store.previewRecovery(caller)
      let approved = false
      let invalidated = false
      const invalidate = () => {
        if (approved && !invalidated) {
          invalidated = true
          store.invalidate()
        }
      }
      if (stage === 'validation') {
        const original = memoryFiles.readMemoryBytes
        vi.spyOn(memoryFiles, 'readMemoryBytes').mockImplementation(async (...args) => {
          const result = await original(...args)
          if (args[0] === root) invalidate()
          return result
        })
      } else {
        const original = memoryBackups.saveMemoryBackup
        vi.spyOn(memoryBackups, 'saveMemoryBackup').mockImplementation(async (...args) => {
          await original(...args)
          invalidate()
        })
      }
      await expect(
        store.recover(caller, preview!.token, async () => {
          approved = true
          return () => undefined
        })
      ).rejects.toMatchObject({ code: 'invalid-receipt' })
      expect(invalidated).toBe(true)
      expect(await readFile(path.join(root, 'MEMORY.md'), 'utf8')).toBe('After')
      expect((await store.previewRecovery(caller))?.batchId).toBe(preview!.batchId)
    }
  )

  it('initializes missing files without replacing existing facts', async () => {
    await writeFile(path.join(root, 'MEMORY.md'), 'Speak Chinese.\n')
    await store.initialize()
    expect((await store.read(caller, 'MEMORY.md')).content).toBe('Speak Chinese.\n')
    await writeFile(path.join(root, '.memories', 'topic.md'), 'A useful detail')
    await writeFile(path.join(root, '.memories', '.draft.md'), 'temporary')
    await writeFile(path.join(root, 'unknown.md'), 'unmanaged')
    expect(await store.list(caller)).toEqual(['.memories/topic.md', 'MEMORY.md'])
  })

  it('rejects an unseen concurrent edit instead of overwriting it', async () => {
    const first = await store.read(caller, 'MEMORY.md')
    const secondCaller = access()
    await save('MEMORY.md', 'Second session fact', secondCaller)
    await expect(
      store.commit(caller, [{ kind: 'write', receipt: first.receipt, content: 'Stale fact' }], 'controlled', approve)
    ).rejects.toMatchObject({ code: 'conflict' })
    expect(await readFile(path.join(root, 'MEMORY.md'), 'utf8')).toBe('Second session fact')
  })

  it('binds receipts to the reader and does not replace an old edit baseline with a newer read', async () => {
    const first = await store.read(caller, 'MEMORY.md')
    await expect(
      store.commit(
        access(),
        [{ kind: 'write', receipt: first.receipt, content: 'Wrong caller' }],
        'controlled',
        approve
      )
    ).rejects.toMatchObject({ code: 'invalid-receipt' })
    await save('MEMORY.md', 'Changed')
    await store.read(caller, 'MEMORY.md')
    await expect(
      store.commit(caller, [{ kind: 'write', receipt: first.receipt, content: 'Old edit' }], 'controlled', approve)
    ).rejects.toMatchObject({ code: 'conflict' })
  })

  it('rechecks the target after approval and preserves the other writer', async () => {
    const read = await store.read(caller, 'MEMORY.md')
    const changeDuringApproval: MemoryApproval = async (proposal) => {
      expect(proposal).toEqual([{ path: 'MEMORY.md', expectedHash: read.hash, content: 'Approved content' }])
      expect(Object.isFrozen(proposal[0])).toBe(true)
      await writeFile(path.join(root, 'MEMORY.md'), 'External edit')
      return () => undefined
    }
    await expect(
      store.commit(
        caller,
        [{ kind: 'write', receipt: read.receipt, content: 'Approved content' }],
        'controlled',
        changeDuringApproval
      )
    ).rejects.toMatchObject({ code: 'conflict' })
    expect(await readFile(path.join(root, 'MEMORY.md'), 'utf8')).toBe('External edit')
  })

  it('invalidates only the revoked caller, including an already approved pending edit', async () => {
    const read = await store.read(caller, 'MEMORY.md')
    const revoke: MemoryApproval = async () => {
      caller.assertAuthorized = () => {
        throw new Error('Caller revoked')
      }
      return () => undefined
    }
    await expect(
      store.commit(caller, [{ kind: 'write', receipt: read.receipt, content: 'Revoked' }], 'controlled', revoke)
    ).rejects.toThrow('Caller revoked')
    await save('MEMORY.md', 'Other caller still works', access())
    expect(await readFile(path.join(root, 'MEMORY.md'), 'utf8')).toBe('Other caller still works')
  })

  it('allows at most one writer to commit the same baseline', async () => {
    const other = access()
    const [first, second] = await Promise.all([store.read(caller, 'MEMORY.md'), store.read(other, 'MEMORY.md')])
    const results = await Promise.allSettled([
      store.commit(caller, [{ kind: 'write', receipt: first.receipt, content: 'A' }], 'controlled', approve),
      store.commit(other, [{ kind: 'write', receipt: second.receipt, content: 'B' }], 'controlled', approve)
    ])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(await readFile(path.join(root, 'MEMORY.md'), 'utf8')).toMatch(/^[AB]$/)
  })

  it('requires absence to remain true when creating a topic', async () => {
    const read = await store.read(caller, '.memories/new.md')
    expect(read.content).toBeNull()
    await writeFile(path.join(root, '.memories', 'new.md'), 'Another creator')
    await expect(
      store.commit(caller, [{ kind: 'write', receipt: read.receipt, content: 'Mine' }], 'controlled', approve)
    ).rejects.toMatchObject({ code: 'conflict' })
  })

  it('does not create a recovery batch for an identical save', async () => {
    await save('MEMORY.md', 'Unchanged')
    const before = await readdir(backups)
    const result = await save('MEMORY.md', 'Unchanged')
    expect(result.batchId).toBeNull()
    expect(result.files[0].outcome).toBe('unchanged')
    expect(await readdir(backups)).toEqual(before)
  })

  it('leaves the target intact when the pre-change backup cannot be written', async () => {
    const originalWrite = memoryFiles.writeMemoryBytes
    vi.spyOn(memoryFiles, 'writeMemoryBytes').mockImplementation(async (directory, relative, bytes) => {
      if (directory === backups) throw new Error('Injected backup failure')
      await originalWrite(directory, relative, bytes)
    })
    await expect(save('MEMORY.md', 'Must not appear')).rejects.toThrow('Injected backup failure')
    expect(await readFile(path.join(root, 'MEMORY.md'), 'utf8')).toBe('')
  })

  it('reports a replacement that succeeded before the write returned an error', async () => {
    const originalWrite = memoryFiles.writeMemoryBytes
    vi.spyOn(memoryFiles, 'writeMemoryBytes').mockImplementation(async (directory, relative, bytes) => {
      await originalWrite(directory, relative, bytes)
      if (directory === root) throw new Error('Injected uncertain outcome')
    })
    const result = await save('MEMORY.md', 'Actually saved')
    expect(result.error).toBe('Injected uncertain outcome')
    expect(result.files[0]).toMatchObject({
      outcome: 'applied',
      hash: memoryFiles.memoryHash(Buffer.from('Actually saved'))
    })
    expect(await readFile(path.join(root, 'MEMORY.md'), 'utf8')).toBe('Actually saved')
    expect((await store.previewRecovery(caller))?.files[0].conflict).toBe(false)
  })
})

describe('limits, access, and recovery', () => {
  it('rechecks approval revocation at the final replacement boundary', async () => {
    let approved = true
    const originalWrite = memoryFiles.writeMemoryBytes
    vi.spyOn(memoryFiles, 'writeMemoryBytes').mockImplementation(async (directory, relative, bytes, assertCurrent) => {
      if (directory === root) approved = false
      await originalWrite(directory, relative, bytes, assertCurrent)
    })
    const read = await store.read(caller, 'MEMORY.md')
    const result = await store.commit(
      caller,
      [{ kind: 'write', receipt: read.receipt, content: 'Revoked' }],
      'controlled',
      async () => () => {
        if (!approved) throw new Error('Approval revoked')
        return undefined
      }
    )
    expect(result.error).toBe('Approval revoked')
    expect(result.files[0].outcome).toBe('unchanged')
    expect(await readFile(path.join(root, 'MEMORY.md'), 'utf8')).toBe('')
  })

  it('checks all maintenance inputs even when an unchanged input is not a write target', async () => {
    await save('.memories/source.md', 'Original source')
    const source = await store.read(caller, '.memories/source.md')
    const destination = await store.read(caller, 'MEMORY.md')
    await save('.memories/source.md', 'Changed source')
    await expect(
      store.commit(
        caller,
        [{ kind: 'write', receipt: destination.receipt, content: 'Stale summary' }],
        'dreaming',
        approve,
        { readReceipts: [source.receipt] }
      )
    ).rejects.toMatchObject({ code: 'conflict' })
    await expect(
      store.commit(caller, [], 'dreaming', approve, { readReceipts: [source.receipt] })
    ).rejects.toMatchObject({ code: 'conflict' })
    expect(await readFile(path.join(root, 'MEMORY.md'), 'utf8')).toBe('')
  })

  it('persists unknown-source tombstones for cleared legacy files and rejects recovery after restart', async () => {
    await save('MEMORY.md', 'Entry fact')
    await save('.memories/topic.md', 'Topic fact')
    await writeFile(path.join(root, 'JOURNAL.md'), 'Historical content')
    await writeFile(path.join(root, '.memories', 'unknown.txt'), 'Unmanaged')
    const preview = await store.previewClear(caller)
    expect(preview.files.map((file) => file.path)).toEqual(['.memories/topic.md', 'MEMORY.md'])
    await expect(store.clear(access(), preview.token, approve)).rejects.toMatchObject({ code: 'invalid-receipt' })
    const cleared = await store.clear(caller, preview.token, approve)
    expect(cleared.files.every((file) => file.outcome === 'applied')).toBe(true)
    expect(await store.list(caller)).toEqual(['.memories/topic.md', 'MEMORY.md'])
    expect(await readFile(path.join(root, 'JOURNAL.md'), 'utf8')).toBe('Historical content')
    expect(await readFile(path.join(root, '.memories', 'unknown.txt'), 'utf8')).toBe('Unmanaged')
    store = new MemoryStore(root, backups)
    for (const name of ['MEMORY.md', '.memories/topic.md']) {
      const content = await readFile(path.join(root, name), 'utf8')
      expect(entriesIn(parseMemoryEntries(content))).toEqual([
        expect.objectContaining({ status: 'forgotten', sources: [], text: '' })
      ])
      expect(content).not.toContain('fact')
    }
    const recovery = await store.previewRecovery(caller)
    await expect(store.recover(caller, recovery!.token, approve)).rejects.toMatchObject({ code: 'conflict' })
  })

  it('rejects clear when the displayed file set or version changes before confirmation', async () => {
    await save('MEMORY.md', 'Keep')
    const preview = await store.previewClear(caller)
    await save('.memories/new.md', 'New file')
    await expect(store.clear(caller, preview.token, approve)).rejects.toMatchObject({ code: 'conflict' })
    const updated = await store.previewClear(caller)
    await save('MEMORY.md', 'New version')
    await expect(store.clear(caller, updated.token, approve)).rejects.toMatchObject({ code: 'conflict' })
    expect((await store.read(caller, '.memories/new.md')).content).toBe('New file')
    expect((await store.read(caller, 'MEMORY.md')).content).toBe('New version')
  })

  it('rechecks live authority before replacement even without a revocation event', async () => {
    let allowed = true
    caller = {
      assertAuthorized: () => {
        if (!allowed) throw new Error('Shared memory disabled')
        return undefined
      }
    }
    const originalWrite = memoryFiles.writeMemoryBytes
    vi.spyOn(memoryFiles, 'writeMemoryBytes').mockImplementation(async (directory, relative, bytes, assertCurrent) => {
      if (directory === root) allowed = false
      await originalWrite(directory, relative, bytes, assertCurrent)
    })
    const result = await save('MEMORY.md', 'Must remain uncommitted')
    expect(result.files[0].outcome).toBe('unchanged')
    expect(result.error).toBe('Shared memory disabled')
    expect(await readFile(path.join(root, 'MEMORY.md'), 'utf8')).toBe('')
  })

  it('refuses entry injection when the full state exceeds the inspection budget', async () => {
    const oversized = Buffer.concat([Buffer.from('Visible fact\n'), Buffer.alloc(MEMORY_BACKUP_BYTES + 1, 65)])
    await writeFile(path.join(root, 'MEMORY.md'), oversized)
    await store.initialize()
    await expect(store.entry(caller)).rejects.toMatchObject({ code: 'limit' })
    await expect(store.read(caller, 'MEMORY.md')).rejects.toMatchObject({ code: 'limit' })
    expect((await readFile(path.join(root, 'MEMORY.md'))).equals(oversized)).toBe(true)
  })

  it.each(['writeFile', 'sync', 'stat', 'close'] as const)(
    'rejects a write revoked during temporary-file %s',
    async (stage) => {
      const actual = await vi.importActual<typeof fs>('node:fs/promises')
      let revoked = false
      caller.assertAuthorized = () => {
        if (revoked) throw new Error('Caller revoked')
      }
      vi.mocked(fs.open).mockImplementation(async (...args) => {
        const handle = await actual.open(...args)
        if (String(args[0]).startsWith(path.join(root, 'MEMORY.md.tmp-'))) {
          const original = handle[stage].bind(handle)
          vi.spyOn(handle, stage).mockImplementation(async (...values: unknown[]) => {
            const result = await Reflect.apply(original, handle, values)
            revoked = true
            return result
          })
        }
        return handle
      })
      const result = await save('MEMORY.md', 'Must remain uncommitted')
      expect(result.error).toBe('Caller revoked')
      expect(result.files[0].outcome).toBe('unchanged')
      expect(await readFile(path.join(root, 'MEMORY.md'), 'utf8')).toBe('')
      expect((await readdir(root)).filter((name) => name.includes('.tmp-'))).toEqual([])
    }
  )

  it('stops a merge before deleting the source when updating its entry link fails', async () => {
    await save('.memories/source.md', 'Condition: only in production')
    const source = await store.read(caller, '.memories/source.md')
    const destination = await store.read(caller, '.memories/destination.md')
    const entry = await store.read(caller, 'MEMORY.md')
    const originalWrite = memoryFiles.writeMemoryBytes
    vi.spyOn(memoryFiles, 'writeMemoryBytes').mockImplementation(async (directory, relative, bytes) => {
      if (directory === root && relative === 'MEMORY.md') throw new Error('Entry update failed')
      await originalWrite(directory, relative, bytes)
    })
    const result = await store.commit(
      caller,
      [
        { kind: 'write', receipt: destination.receipt, content: source.content! },
        { kind: 'write', receipt: entry.receipt, content: '[[.memories/destination]]' },
        { kind: 'delete', receipt: source.receipt }
      ],
      'dreaming',
      approve
    )
    expect(result.files.map((file) => file.outcome)).toEqual(['applied', 'unchanged', 'pending'])
    expect(await readFile(path.join(root, '.memories', 'source.md'), 'utf8')).toBe(source.content)
    expect(await readFile(path.join(root, 'MEMORY.md'), 'utf8')).toBe('')
  })

  it('recovers a confirmed disk write after its manifest update failed and the owner restarted', async () => {
    const originalWrite = memoryFiles.writeMemoryBytes
    let manifestWrites = 0
    vi.spyOn(memoryFiles, 'writeMemoryBytes').mockImplementation(async (directory, relative, bytes) => {
      if (directory === backups && ++manifestWrites > 1) throw new Error('Manifest update failed')
      await originalWrite(directory, relative, bytes)
    })
    const saved = await save('MEMORY.md', 'Saved before the crash')
    expect(saved.files[0].outcome).toBe('applied')
    vi.restoreAllMocks()
    store = new MemoryStore(root, backups)
    await store.initialize()
    const preview = await store.previewRecovery(caller)
    expect(preview!.files).toMatchObject([{ path: 'MEMORY.md', conflict: false }])
    await store.recover(caller, preview!.token, approve)
    expect(await readFile(path.join(root, 'MEMORY.md'), 'utf8')).toBe('')
  })

  it.each([false, true])('preserves entry deletion across restart (later pending write=%s)', async (pending) => {
    await save('MEMORY.md', 'Keep this original')
    const original = await store.read(caller, 'MEMORY.md')
    const deleted = await store.commit(caller, [{ kind: 'delete', receipt: original.receipt }], 'controlled', approve)
    if (pending) {
      await createMemoryBackup(
        backups,
        [{ path: 'MEMORY.md', before: null, after: Buffer.from('Unapplied') }],
        'controlled'
      )
    }
    store = new MemoryStore(root, backups)
    await store.initialize()
    expect((await store.read(caller, 'MEMORY.md')).content).toBeNull()
    const preview = await store.previewRecovery(caller)
    expect(preview).toMatchObject({ batchId: deleted.batchId, files: [{ path: 'MEMORY.md', conflict: false }] })
    await store.recover(caller, preview!.token, approve)
    expect(await readFile(path.join(root, 'MEMORY.md'), 'utf8')).toBe('Keep this original')
  })

  it.each(['', 'A later file'])(
    'does not mistake a later entry %j for initialization during recovery',
    async (later) => {
      await save('MEMORY.md', 'Original')
      const original = await store.read(caller, 'MEMORY.md')
      await store.commit(caller, [{ kind: 'delete', receipt: original.receipt }], 'controlled', approve)
      await writeFile(path.join(root, 'MEMORY.md'), later)
      store = new MemoryStore(root, backups)
      await store.initialize()
      const preview = await store.previewRecovery(caller)
      expect(preview!.files).toMatchObject([{ path: 'MEMORY.md', conflict: true }])
      const result = await store.recover(caller, preview!.token, approve)
      expect(result.files).toMatchObject([{ path: 'MEMORY.md', outcome: 'conflict' }])
      expect(await readFile(path.join(root, 'MEMORY.md'), 'utf8')).toBe(later)
    }
  )

  it.each([false, true])('skips an unapplied crash batch when selecting recovery (prior=%s)', async (prior) => {
    const saved = prior ? await save('MEMORY.md', 'Saved') : undefined
    await createMemoryBackup(
      backups,
      [{ path: 'MEMORY.md', before: Buffer.from(prior ? 'Saved' : ''), after: Buffer.from('Never applied') }],
      'controlled'
    )
    const preview = await store.previewRecovery(caller)
    if (!saved) {
      expect(preview).toBeUndefined()
      return
    }
    expect(preview?.batchId).toBe(saved.batchId)
    expect(preview?.files).toMatchObject([{ path: 'MEMORY.md', conflict: false }])
    await store.recover(caller, preview!.token, approve)
    expect(await readFile(path.join(root, 'MEMORY.md'), 'utf8')).toBe('')
  })

  it('protects the latest recovery batch when a second large backup would exceed capacity', async () => {
    const original = Buffer.alloc(9 * 1024 * 1024, 65)
    await writeFile(path.join(root, 'MEMORY.md'), original)
    const first = await save('MEMORY.md', 'Small replacement')
    await writeFile(path.join(root, 'MEMORY.md'), original)
    await expect(save('MEMORY.md', 'Second replacement')).rejects.toMatchObject({ code: 'backup-capacity' })
    expect((await readFile(path.join(root, 'MEMORY.md'))).equals(original)).toBe(true)
    expect((await store.previewRecovery(caller))?.batchId).toBe(first.batchId)
  })

  it('preserves invalid UTF-8 instead of issuing an editable replacement baseline', async () => {
    await writeFile(path.join(root, 'MEMORY.md'), Buffer.from([0xc3, 0x28]))
    await expect(store.read(caller, 'MEMORY.md')).rejects.toThrow()
    expect(await readFile(path.join(root, 'MEMORY.md'))).toEqual(Buffer.from([0xc3, 0x28]))
  })

  it('enforces UTF-8 bytes and entry lines, preserving oversized external originals', async () => {
    await expect(save('MEMORY.md', '中'.repeat(8334))).rejects.toMatchObject({ code: 'limit' })
    await expect(save('MEMORY.md', 'fact\n'.repeat(201))).rejects.toMatchObject({ code: 'limit' })
    const original = 'fact\n'.repeat(201)
    await writeFile(path.join(root, 'MEMORY.md'), original)
    expect(await store.entry(caller)).toEqual({ content: 'fact\n'.repeat(200), truncated: true })
    expect(await readFile(path.join(root, 'MEMORY.md'), 'utf8')).toBe(original)
    expect((await store.read(caller, 'MEMORY.md')).content).toBe(original)
  })

  it.each([
    '../other.md',
    '.memories/../other.md',
    '.memories/x/other.md',
    'memory/FACT.md',
    '.memories/CON.md',
    '.memories/x:stream.md'
  ])('rejects unmanaged target %s before exposing its content', async (target) => {
    await expect(store.read(caller, target)).rejects.toMatchObject({ code: 'invalid-path' })
  })

  it('does not expose names when the caller is unauthorized', async () => {
    const denied: MemoryAccess = {
      assertAuthorized: () => {
        throw new Error('Unauthorized')
      }
    }
    await expect(store.list(denied)).rejects.toThrow('Unauthorized')
    await expect(store.entry(denied)).rejects.toThrow('Unauthorized')
  })

  it('rejects a topic directory junction without reading its files', async () => {
    await rmdir(path.join(root, '.memories'))
    await symlink(backups, path.join(root, '.memories'), process.platform === 'win32' ? 'junction' : 'dir')
    await expect(store.list(caller)).rejects.toMatchObject({ code: 'invalid-path' })
  })

  it('retains no more than five complete batches and can recover the latest one', async () => {
    for (let index = 0; index < 7; index++) await save('MEMORY.md', `Fact ${index}`)
    expect((await readdir(backups)).filter((name) => name.endsWith('.json'))).toHaveLength(5)
    const preview = await store.previewRecovery(caller)
    await store.recover(caller, preview!.token, approve)
    expect((await store.read(caller, 'MEMORY.md')).content).toBe('Fact 5')
  })

  it('rejects a backup exceeding capacity without truncating the original', async () => {
    const original = Buffer.alloc(MEMORY_BACKUP_BYTES, 65)
    await writeFile(path.join(root, 'MEMORY.md'), original)
    await expect(save('MEMORY.md', 'Small replacement')).rejects.toMatchObject({ code: 'backup-capacity' })
    expect((await readFile(path.join(root, 'MEMORY.md'))).equals(original)).toBe(true)
  })

  it('keeps later edits and the recoverable original when recovery conflicts', async () => {
    await save('MEMORY.md', 'Before')
    await save('MEMORY.md', 'After')
    await writeFile(path.join(root, 'MEMORY.md'), 'Later external edit')
    const preview = await store.previewRecovery(caller)
    expect(preview!.files[0].conflict).toBe(true)
    const result = await store.recover(caller, preview!.token, approve)
    expect(result.files[0].outcome).toBe('conflict')
    expect(await readFile(path.join(root, 'MEMORY.md'), 'utf8')).toBe('Later external edit')
    expect((await store.previewRecovery(caller))?.batchId).toBe(preview!.batchId)
  })

  it('refuses to undo deletion over a later same-name file', async () => {
    await save('.memories/topic.md', 'Original')
    const read = await store.read(caller, '.memories/topic.md')
    await store.commit(caller, [{ kind: 'delete', receipt: read.receipt }], 'controlled', approve)
    await writeFile(path.join(root, '.memories', 'topic.md'), 'New owner')
    const preview = await store.previewRecovery(caller)
    const result = await store.recover(caller, preview!.token, approve)
    expect(result.files[0].outcome).toBe('conflict')
    expect(await readFile(path.join(root, '.memories', 'topic.md'), 'utf8')).toBe('New owner')
  })

  it('invalidates old edits when recovering, even if the original hash returns', async () => {
    const original = await store.read(caller, 'MEMORY.md')
    await save('MEMORY.md', 'Temporary')
    const preview = await store.previewRecovery(caller)
    await store.recover(caller, preview!.token, approve)
    await expect(
      store.commit(caller, [{ kind: 'write', receipt: original.receipt, content: 'Stale' }], 'controlled', approve)
    ).rejects.toMatchObject({ code: 'invalid-receipt' })
  })
})

describe('model state views', () => {
  const active: MemoryEntry = {
    schemaVersion: 1,
    id: 'active',
    status: 'active',
    text: 'current fact',
    derivedFrom: [],
    sources: [{ kind: 'chat', conversationId: 'c', messageId: 'a', sourceVersion: '1' }]
  }
  const put = (target: string, entries: MemoryEntry[]) =>
    writeFile(path.join(root, target), serializeMemoryEntries(entries))

  it('renders current and historical facts without a whole-file receipt', async () => {
    await put('MEMORY.md', [
      active,
      { ...active, id: 'old', status: 'expired', text: 'old fact', sources: [], validTo: '2026-01-01T00:00:00Z' }
    ])
    const current = await store.modelRead(caller, 'MEMORY.md')
    expect(current.content).toContain('current fact')
    expect(current.content).not.toContain('old fact')
    expect(current.receipt).toBe('')
    const history = await store.modelRead(caller, 'MEMORY.md', 'historical')
    expect(history.content).toContain('old fact')
    expect(history.content).toContain('2026-01-01')
    await expect(
      store.commit(caller, [{ kind: 'write', receipt: current.receipt, content: 'overwrite' }], 'controlled', approve)
    ).rejects.toThrow()
    expect(await readFile(path.join(root, 'MEMORY.md'), 'utf8')).toContain('old fact')
  })

  it('suppresses cross-file sources across versions and transitive derivatives', async () => {
    await put('.memories/state.md', [{ ...active, id: 'forgotten', status: 'forgotten', text: '' }])
    await put('MEMORY.md', [
      { ...active, sources: [{ ...active.sources[0], sourceVersion: '2' }] },
      { ...active, id: 'derived', sources: [], derivedFrom: ['active'], text: 'derived secret' },
      { ...active, id: 'safe', sources: [], text: 'safe fact' }
    ])
    const view = await store.modelRead(caller, 'MEMORY.md', 'historical')
    expect(view.content).toContain('safe fact')
    expect(view.content).not.toContain('current fact')
    expect(view.content).not.toContain('derived secret')
    await expect(store.modelRead(caller, 'MEMORY.md', 'extraction')).rejects.toThrow()
  })

  it('rejects malformed or duplicate scope metadata and ambiguous legacy text', async () => {
    await put('MEMORY.md', [active])
    await put('.memories/state.md', [active])
    await expect(store.modelRead(caller, 'MEMORY.md')).rejects.toThrow()
    await writeFile(path.join(root, '.memories/state.md'), '<!-- cherry-memory-entry:v9\n{}\n-->')
    await expect(store.modelRead(caller, 'MEMORY.md')).rejects.toThrow()
    await put('.memories/state.md', [{ ...active, id: 'forgotten', status: 'forgotten', text: '', sources: [] }])
    await writeFile(path.join(root, 'MEMORY.md'), 'legacy secret')
    await expect(store.modelRead(caller, 'MEMORY.md')).rejects.toThrow()
    await expect(store.modelRead(caller, 'MEMORY.md', 'extraction')).rejects.toThrow()
  })

  it('invalidates captured views after cross-file edits, revocation, or generation changes', async () => {
    await put('MEMORY.md', [active])
    const view = await store.modelRead(caller, 'MEMORY.md')
    await put('.memories/state.md', [{ ...active, id: 'forgotten', status: 'forgotten', text: '' }])
    await expect(view.validate()).rejects.toThrow()
    const fresh = await store.modelRead(caller, 'MEMORY.md')
    store.invalidate()
    await expect(fresh.validate()).rejects.toThrow()
    let allowed = true
    const owner = {
      assertAuthorized: (): undefined => {
        if (!allowed) throw new Error('revoked')
        return undefined
      }
    }
    const revoked = await store.modelRead(owner, 'MEMORY.md')
    allowed = false
    await expect(revoked.validate()).rejects.toThrow('revoked')
  })
})
