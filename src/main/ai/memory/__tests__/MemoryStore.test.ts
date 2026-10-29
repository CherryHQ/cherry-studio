import { mkdtemp, readFile, readdir, rmdir, symlink, unlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { MEMORY_BACKUP_BYTES } from '../memoryBackups'
import * as memoryFiles from '../memoryFiles'
import { type MemoryAccess, type MemoryApproval, MemoryStore } from '../MemoryStore'

const approve: MemoryApproval = async () => async () => undefined
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
  await removeFixtureFiles(fixture)
})

async function save(target: string, content: string, owner = caller) {
  const read = await store.read(owner, target)
  return store.commit(owner, [{ kind: 'write', receipt: read.receipt, content }], 'controlled', approve)
}

describe('memory save contract', () => {
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
      return async () => undefined
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
      store.invalidate(caller)
      return async () => undefined
    }
    await expect(
      store.commit(caller, [{ kind: 'write', receipt: read.receipt, content: 'Revoked' }], 'controlled', revoke)
    ).rejects.toMatchObject({ code: 'invalid-receipt' })
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

  it('checks both ends of a rename and restores both ends', async () => {
    await save('.memories/source.md', 'Fact with a condition')
    const source = await store.read(caller, '.memories/source.md')
    const destination = await store.read(caller, '.memories/destination.md')
    const moved = await store.commit(
      caller,
      [{ kind: 'rename', receipt: source.receipt, destinationReceipt: destination.receipt }],
      'controlled',
      approve
    )
    expect(moved.files.every((file) => file.outcome === 'applied')).toBe(true)
    expect((await store.read(caller, '.memories/source.md')).content).toBeNull()
    const preview = await store.previewRecovery(caller)
    expect(preview?.batchId).toBe(moved.batchId)
    const recovered = await store.recover(caller, preview!.token, approve)
    expect(recovered.files.every((file) => file.outcome === 'applied')).toBe(true)
    expect((await store.read(caller, '.memories/source.md')).content).toBe('Fact with a condition')
    expect((await store.read(caller, '.memories/destination.md')).content).toBeNull()
  })

  it.skipIf(process.platform !== 'win32')(
    'rejects a rename between case aliases of the same Windows file',
    async () => {
      await save('.memories/topic.md', 'Keep me')
      const source = await store.read(caller, '.memories/topic.md')
      const destination = await store.read(caller, '.memories/TOPIC.md')
      await expect(
        store.commit(
          caller,
          [{ kind: 'rename', receipt: source.receipt, destinationReceipt: destination.receipt }],
          'controlled',
          approve
        )
      ).rejects.toMatchObject({ code: 'conflict' })
      expect((await store.read(caller, '.memories/topic.md')).content).toBe('Keep me')
    }
  )

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

  it('bounds entry injection when an external editor creates an oversized file', async () => {
    const oversized = Buffer.concat([Buffer.from('Visible fact\n'), Buffer.alloc(MEMORY_BACKUP_BYTES + 1, 65)])
    await writeFile(path.join(root, 'MEMORY.md'), oversized)
    await store.initialize()
    expect(await store.entry(caller)).toEqual({ content: 'Visible fact\n', truncated: true })
    await expect(store.read(caller, 'MEMORY.md')).rejects.toMatchObject({ code: 'limit' })
    expect((await readFile(path.join(root, 'MEMORY.md'))).equals(oversized)).toBe(true)
  })

  it('checks revocation at the replacement boundary after temporary-file preparation', async () => {
    const originalWrite = memoryFiles.writeMemoryBytes
    vi.spyOn(memoryFiles, 'writeMemoryBytes').mockImplementation(async (directory, relative, bytes, assertCurrent) => {
      if (directory === root) store.invalidate(caller)
      await originalWrite(directory, relative, bytes, assertCurrent)
    })
    const result = await save('MEMORY.md', 'Must remain uncommitted')
    expect(result.files[0].outcome).toBe('unchanged')
    expect(result.error).toMatch(/invalidated/)
    expect(await readFile(path.join(root, 'MEMORY.md'), 'utf8')).toBe('')
    expect((await readdir(root)).filter((name) => name.endsWith('.tmp'))).toEqual([])
  })

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
