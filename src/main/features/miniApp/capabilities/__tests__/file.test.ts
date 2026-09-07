import fs from 'node:fs'

import { fileEntryTable } from '@data/db/schemas/file'
import { miniAppFileRefTable } from '@data/db/schemas/fileRelations'
import { miniAppTable } from '@data/db/schemas/miniApp'
import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { BrowserWindow, dialog, webContents } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { type CallLease, MiniAppQuiescingError } from '../../runtime/MiniAppRuntimeService'
import { base64CharCap, MINI_APP_QUOTAS } from '../quota'

// Hoisted: the static `MiniAppRuntimeService` import above pulls `@application` in and
// runs the mock factory before any top-level `const` of this file is initialised.
const { created, mintEntry, createInternalEntry, readEntry, read, permanentDelete, generation, visible, leaseFor } =
  vi.hoisted(() => {
    const created: { id: string; data: Uint8Array }[] = []
    // Faithful to FileManager where the capability depends on it: a real entry is a
    // `file_entry` ROW (the ref table FK-points at it and usage sums its `size`).
    const mintEntry = async ({
      data,
      cleanupPolicy
    }: {
      data: Uint8Array
      cleanupPolicy: 'delete_when_unreferenced'
    }) => {
      const id = `f${created.length + 1}`
      created.push({ id, data })
      const entry = { id, origin: 'internal' as const, name: 'blob', ext: 'bin', size: data.byteLength, cleanupPolicy }
      dbh.db.insert(fileEntryTable).values(entry).run()
      return entry
    }
    const createInternalEntry = vi.fn(mintEntry)
    // Honours `encoding` the way FileManager does: 'binary' hands back bytes, and a guest
    // cannot receive bytes — so a capability that asks for the wrong one must fail here.
    const readEntry = async (id: string, options?: { encoding?: 'text' | 'base64' | 'binary' }) => {
      const data = created.find((c) => c.id === id)!.data
      const content = options?.encoding === 'base64' ? Buffer.from(data).toString('base64') : data
      return { content, mime: 'application/octet-stream' }
    }
    const read = vi.fn(readEntry)
    const permanentDelete = vi.fn(async (id: string) => {
      dbh.db.delete(fileEntryTable).where(eq(fileEntryTable.id, id)).run()
    })
    const generation = { value: 1 }
    return {
      created,
      mintEntry,
      createInternalEntry,
      readEntry,
      read,
      permanentDelete,
      generation,
      visible: { value: true },
      leaseFor: vi.fn((appId: string) => ({ appId, generation: generation.value }))
    }
  })

// `save` takes a lease and re-checks it after the await, so the runtime service must
// be mounted here too or every case throws before its first assertion.
vi.mock('@application', async () => {
  const { mockMiniAppApplication } = await import('../../__tests__/applicationMock')
  return mockMiniAppApplication({
    FileManager: { createInternalEntry, read, permanentDelete, getPhysicalPath: (id: string) => `/blobs/${id}.bin` },
    MiniAppRuntimeService: {
      leaseFor,
      assertLeaseValid: (lease: CallLease) => {
        if (lease.generation !== generation.value) throw new MiniAppQuiescingError(lease.appId)
      },
      isGuestVisible: () => visible.value,
      displayNameOf: () => 'My Game'
    }
  })
})
// The dialog title is asserted by key: the catalog is not what is under test.
vi.mock('@main/i18n', () => ({ t: (key: string, vars?: { name: string }) => `${key}:${vars?.name ?? ''}` }))

const { fileCapability } = await import('../file')
const { QuotaExceededError, RateLimitedError } = await import('../quota')
const { InvalidArgumentError } = await import('../../errors')
const { PermissionDeniedError } = await import('../../grants')

// Module-level so the hoisted FileManager mock can reach the same DB the capability writes.
const dbh = setupTestDatabase()

const A = 'com.example.a'

describe('cherry.file', () => {
  // The write-rate limiter is a module singleton keyed by app id and clocked by
  // `Date.now()`; the whole file runs inside its 1 s window. Jump the clock per case
  // so each starts with a fresh call window and a full byte bucket. Only `Date` is
  // faked — real timers keep `await` and `vi.waitFor` moving.
  let clock = Date.now()
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    clock += 5_000
    vi.setSystemTime(clock)
  })
  afterEach(() => {
    vi.useRealTimers()
    read.mockImplementation(readEntry)
  })

  const insertApp = (appId: string) =>
    dbh.db
      .insert(miniAppTable)
      .values({
        appId,
        kind: 'app',
        presetMiniAppId: null,
        name: appId,
        url: `cherry-miniapp://${appId}/index.html`,
        status: 'enabled',
        orderKey: 'a0'
      })
      .run()

  /** Rows the way a finished `save` leaves them, minus the `save` — no rate-limit tokens spent. */
  const seedFiles = (appId: string, count: number, size: number) => {
    dbh.db
      .insert(fileEntryTable)
      .values(
        Array.from({ length: count }, (_, i) => ({
          id: `pre${i}`,
          origin: 'internal' as const,
          name: 'x',
          ext: 'bin',
          size,
          cleanupPolicy: 'delete_when_unreferenced' as const
        }))
      )
      .run()
    dbh.db
      .insert(miniAppFileRefTable)
      .values(
        Array.from({ length: count }, (_, i) => ({ fileEntryId: `pre${i}`, sourceId: appId, logicalName: `n${i}` }))
      )
      .run()
  }

  it('round-trips a save under a logical name', async () => {
    insertApp(A)
    await fileCapability.save(A, { name: 'slot1', data: 'aGVsbG8=' })
    expect(await fileCapability.load(A, { name: 'slot1' })).toEqual({ data: 'aGVsbG8=' })
  })

  it('creates entries with delete_when_unreferenced so uninstall reclaims them', async () => {
    insertApp(A)
    await fileCapability.save(A, { name: 'slot1', data: 'aGVsbG8=' })
    expect(createInternalEntry).toHaveBeenCalledWith(
      expect.objectContaining({ cleanupPolicy: 'delete_when_unreferenced' })
    )
  })

  it('overwrites the same logical name instead of accumulating refs', async () => {
    insertApp(A)
    await fileCapability.save(A, { name: 'slot1', data: 'aGVsbG8=' })
    await fileCapability.save(A, { name: 'slot1', data: 'd29ybGQ=' })

    expect(dbh.db.select().from(miniAppFileRefTable).all()).toHaveLength(1)
    expect(await fileCapability.load(A, { name: 'slot1' })).toEqual({ data: 'd29ybGQ=' })
  })

  it('refuses a save before it reaches the queue at all', async () => {
    // The bug: `save` handed the RAW params to the per-app queue and parsed, decoded and
    // rate-limited them only inside it, so every queued call held the guest's whole base64
    // string in main-process memory while it waited — the exact allocation the limiter
    // exists to refuse. `leaseFor` is the observable: it is taken on the way INTO the
    // queue, so a refusal that never took one never got that far.
    insertApp(A)
    leaseFor.mockClear()

    await expect(fileCapability.save(A, { name: 'bad/name', data: 'AAAA' })).rejects.toThrow()

    expect(leaseFor).not.toHaveBeenCalled()
  })

  it('still takes a lease for a save it accepts', async () => {
    // The negative control: without it the case above passes just as well if `save` stopped
    // leasing altogether, which would silently drop the quiesce check it exists for.
    insertApp(A)
    leaseFor.mockClear()

    await fileCapability.save(A, { name: 'fine', data: 'AAAA' })

    expect(leaseFor).toHaveBeenCalled()
  })

  it('refuses a burst that is under the call limit but over the byte limit', async () => {
    // 20 calls/second at the 10 MB cap is 200 MB/s, and an overwrite hands the logical
    // quota straight back — counts alone never bound the disk. 16 x 1 MB stays under
    // the 20-call window but overflows the 12 MB bucket.
    insertApp(A)
    const oneMeg = 'A'.repeat(base64CharCap(1024 * 1024) - 4)

    const results: unknown[] = []
    for (let i = 0; i < 16; i++) {
      results.push(await fileCapability.save(A, { name: `f${i}`, data: oneMeg }).catch((e) => e))
    }

    expect(results.some((r) => r instanceof QuotaExceededError)).toBe(true)
    // Negative control: it must be the BYTE window, not the 20-call one, that tripped.
    expect(results.filter((r) => !(r instanceof Error))).not.toHaveLength(0)
  })

  it('reclaims the superseded entry immediately rather than leaving it to the pass', async () => {
    // The quota counts REFS, so an app rewriting one slot reads a flat 10 MB forever.
    // The pass drains 200/hour; a game autosaving once a second makes 3600.
    insertApp(A)
    await fileCapability.save(A, { name: 'slot1', data: 'aGVsbG8=' })
    // Ids come from `created`, which is module-level and never reset: hardcoding `f1`
    // would make this case depend on how many saves ran before it.
    const superseded = created.at(-1)!.id
    await fileCapability.save(A, { name: 'slot1', data: 'd29ybGQ=' })
    const current = created.at(-1)!.id

    expect(permanentDelete).toHaveBeenCalledWith(superseded)
    // Negative control: reclaiming BOTH deletes the file the app just saved, and a
    // bare `toHaveBeenCalled` cannot tell those two implementations apart.
    expect(permanentDelete).not.toHaveBeenCalledWith(current)
  })

  it('reclaims the entry it created when the write is refused', async () => {
    // The entry is minted before the transaction, so a refused write (an uninstall
    // landed in between) leaves bytes on disk no row has ever pointed at.
    insertApp(A)
    // The lease is taken synchronously at the top of `save`, so the world has to change
    // AFTER that and before the transaction — i.e. while the entry is being minted.
    createInternalEntry.mockImplementationOnce(async (input) => {
      generation.value += 1
      return mintEntry(input)
    })

    await expect(fileCapability.save(A, { name: 'slot1', data: 'eA==' })).rejects.toThrow(MiniAppQuiescingError)

    expect(permanentDelete).toHaveBeenCalledWith(created.at(-1)!.id)
    expect(dbh.db.select().from(miniAppFileRefTable).all()).toHaveLength(0)
  })

  it('lists only its own logical names', async () => {
    insertApp(A)
    await fileCapability.save(A, { name: 'b', data: 'eA==' })
    await fileCapability.save(A, { name: 'a', data: 'eA==' })
    expect(await fileCapability.list(A)).toEqual({ names: ['a', 'b'] })
  })

  it('deletes a file, drops its ref and reclaims the blob', async () => {
    insertApp(A)
    await fileCapability.save(A, { name: 'slot1', data: 'eA==' })
    await fileCapability.delete(A, { name: 'slot1' })

    expect(dbh.db.select().from(miniAppFileRefTable).all()).toHaveLength(0)
    expect(await fileCapability.load(A, { name: 'slot1' })).toEqual({ data: null })
    // save-then-delete in a loop is the same unbounded orphan producer as overwriting,
    // except the quota reads zero the whole time.
    expect(permanentDelete).toHaveBeenCalledWith(created.at(-1)!.id)
  })

  it('does not let a delete slip through a save’s await gap and lose the deletion', async () => {
    // `saveSerialized` awaits `createInternalEntry` between resolving the previous ref and
    // inserting the new one. A delete off the queue lands inside that gap, finds nothing,
    // reports `ok` — and the save then commits the row, so the file the guest was told was
    // deleted is back. The delete must take the same chain and run after the insert.
    insertApp(A)
    let release: (entry: unknown) => void = () => {}
    createInternalEntry.mockImplementationOnce(
      (args: Parameters<typeof mintEntry>[0]) =>
        new Promise((resolve) => {
          release = () => resolve(mintEntry(args))
        })
    )

    const saving = fileCapability.save(A, { name: 'slot1', data: 'eA==' })
    await vi.waitFor(() => expect(createInternalEntry).toHaveBeenCalled())
    const deleting = fileCapability.delete(A, { name: 'slot1' })
    release(undefined)
    await saving
    await deleting

    expect(await fileCapability.list(A)).toEqual({ names: [] })
    expect(dbh.db.select().from(miniAppFileRefTable).all()).toHaveLength(0)
  })

  it('refuses a queued delete once the app was reinstalled under it', async () => {
    // Queueing `delete` is what created this window. Off the chain it ran immediately; on
    // it, behind a save awaiting `createInternalEntry`, it waits long enough for an update
    // or reinstall to commit — and the name it resolves afterwards belongs to the NEW
    // installation. `save` guards the same wait with a lease; the delete had none, so the
    // fix for one bug had widened another.
    insertApp(A)
    await fileCapability.save(A, { name: 'slot1', data: 'eA==' })
    let release: () => void = () => {}
    createInternalEntry.mockImplementationOnce(
      (args: Parameters<typeof mintEntry>[0]) =>
        new Promise((resolve) => {
          release = () => resolve(mintEntry(args))
        })
    )

    const saving = fileCapability.save(A, { name: 'other', data: 'eA==' })
    await vi.waitFor(() => expect(createInternalEntry).toHaveBeenCalled())
    const deleting = fileCapability.delete(A, { name: 'slot1' })
    // The reinstall commits while the delete sits in the queue behind that save.
    generation.value += 1
    release()
    await saving.catch(() => undefined)

    await expect(deleting).rejects.toThrow(MiniAppQuiescingError)
    // The file the PREVIOUS generation named is still the new generation's file.
    expect(await fileCapability.list(A)).toMatchObject({ names: ['slot1'] })
  })

  it('refuses a concurrent load once the decode budget is spent', async () => {
    // The bug this guards: a per-call cap with no total. Ten concurrent 10 MB loads
    // are 100 MB resident no matter how small each one is allowed to be.
    insertApp(A)
    // Seeded, not saved: five 10 MB saves would trip the write limiter's 12 MB bucket
    // long before the load path under test is reached.
    seedFiles(A, 5, MINI_APP_QUOTAS.file.single)

    // Collect the resolvers: a single variable would be overwritten by each call and
    // only the last could ever be freed, deadlocking the test.
    const unblocks: Array<() => void> = []
    read.mockImplementation(
      () => new Promise((r) => unblocks.push(() => r({ content: 'AAAA', mime: 'application/octet-stream' })))
    )

    const started = Array.from({ length: 5 }, (_, i) => fileCapability.load(A, { name: `n${i}` }).catch((e) => e))
    // The refusal is synchronous — it happens before the read is even attempted.
    await vi.waitFor(() => expect(unblocks.length).toBeGreaterThan(0))
    for (const release of unblocks) release()
    const results = await Promise.all(started)

    expect(results.some((r) => r instanceof QuotaExceededError)).toBe(true)
    expect(unblocks.length).toBeLessThan(5)
  })

  it('frees the decode budget when a load finishes', async () => {
    // Positive control for the case above: with the budget never returned, three
    // 10 MB loads in a row would leave `file.load` RateLimited for the rest of the process.
    insertApp(A)
    seedFiles(A, 3, MINI_APP_QUOTAS.file.single)
    read.mockImplementation(async () => ({ content: 'AAAA', mime: 'application/octet-stream' }))

    for (let i = 0; i < 3; i++) {
      await expect(fileCapability.load(A, { name: `n${i}` })).resolves.toEqual({ data: 'AAAA' })
    }
  })

  it('lets a full quota be overwritten in place', async () => {
    // The autosave case: the count cap of files at the byte cap, and the app rewrites one. Counting
    // the old ref against the new write refuses every save the user makes from then on.
    insertApp(A)
    const { bytes, count } = MINI_APP_QUOTAS.file
    const each = Math.floor(bytes / count)
    seedFiles(A, count, each)
    // Sized so the rewrite lands EXACTLY on the byte cap: only a check that credits
    // the superseded file's size and slot lets it through.
    const grown = bytes - each * (count - 1)

    await expect(
      fileCapability.save(A, { name: 'n0', data: Buffer.alloc(grown, 1).toString('base64') })
    ).resolves.toEqual({ ok: true })
    expect(await fileCapability.usage(A)).toMatchObject({ bytes, count })
  })

  it('rejects an oversized payload before decoding it', async () => {
    // The bug this guards: quota enforced after `Buffer.from` — the app gets a tidy
    // QuotaExceededError and the host gets the allocation anyway.
    insertApp(A)
    const decode = vi.spyOn(Buffer, 'from')
    const huge = 'A'.repeat(base64CharCap(MINI_APP_QUOTAS.file.single) + 4)
    try {
      await expect(fileCapability.save(A, { name: 'save1', data: huge })).rejects.toThrow()
      expect(decode).not.toHaveBeenCalled()
    } finally {
      // A global spy that outlives a failing case poisons every case after it.
      decode.mockRestore()
    }
  })

  it('rejects a logical name containing a path separator', async () => {
    insertApp(A)
    await expect(fileCapability.save(A, { name: '../escape', data: 'eA==' })).rejects.toThrow()
  })

  it('does not let concurrent saves all pass the same usage check', async () => {
    insertApp(A)
    // One slot left: two concurrent saves must not both succeed.
    seedFiles(A, MINI_APP_QUOTAS.file.count - 1, 1)

    const results = await Promise.allSettled([
      fileCapability.save(A, { name: 'x1', data: 'eA==' }),
      fileCapability.save(A, { name: 'x2', data: 'eA==' })
    ])
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1)
  })

  it('throws QuotaExceededError past the file count', async () => {
    insertApp(A)
    seedFiles(A, MINI_APP_QUOTAS.file.count, 1)

    await expect(fileCapability.save(A, { name: 'one-too-many', data: 'eA==' })).rejects.toThrow(QuotaExceededError)
  })

  describe('export', () => {
    const SENDER = 7
    const guest = { id: SENDER, hostWebContents: { id: 1 } }
    const parent = { id: 'host-window' }
    const copyFile = vi.spyOn(fs.promises, 'copyFile').mockResolvedValue(undefined)

    beforeEach(() => {
      visible.value = true
      vi.mocked(webContents.fromId).mockReturnValue(guest as unknown as Electron.WebContents)
      Object.assign(BrowserWindow, { fromWebContents: vi.fn(() => parent) })
      vi.mocked(dialog.showSaveDialog).mockReset()
      copyFile.mockClear()
    })

    const saved = async (name = 'notes.txt') => {
      insertApp(A)
      await fileCapability.save(A, { name, data: Buffer.from('hello').toString('base64') })
    }

    it('opens the save dialog on the host window, named for the app, and copies the blob where the user chose', async () => {
      await saved()
      vi.mocked(dialog.showSaveDialog).mockResolvedValue({ canceled: false, filePath: '/Users/u/out.txt' })

      await expect(fileCapability.export(A, { name: 'notes.txt' }, SENDER)).resolves.toEqual({ saved: true })

      expect(dialog.showSaveDialog).toHaveBeenCalledWith(parent, {
        title: 'dialog.mini_app_export:My Game',
        defaultPath: 'notes.txt'
      })
      expect(copyFile).toHaveBeenCalledWith(expect.stringMatching(/^\/blobs\/f\d+\.bin$/), '/Users/u/out.txt')
    })

    it('offers suggestedName as the default file name', async () => {
      await saved()
      vi.mocked(dialog.showSaveDialog).mockResolvedValue({ canceled: true, filePath: '' })

      await fileCapability.export(A, { name: 'notes.txt', suggestedName: 'My notes.txt' }, SENDER)

      expect(dialog.showSaveDialog).toHaveBeenCalledWith(
        parent,
        expect.objectContaining({ defaultPath: 'My notes.txt' })
      )
    })

    it('resolves saved:false when the user cancels, writing nothing', async () => {
      await saved()
      vi.mocked(dialog.showSaveDialog).mockResolvedValue({ canceled: true, filePath: '' })

      await expect(fileCapability.export(A, { name: 'notes.txt' }, SENDER)).resolves.toEqual({ saved: false })
      expect(copyFile).not.toHaveBeenCalled()
    })

    it('refuses while the app is hidden, before any dialog opens', async () => {
      // The bug this guards: a pooled app in the background popping a save dialog over
      // whatever the user is doing — the dialog is the consent, so it must come from a
      // pane they can see.
      await saved()
      visible.value = false

      await expect(fileCapability.export(A, { name: 'notes.txt' }, SENDER)).rejects.toThrow(PermissionDeniedError)
      expect(dialog.showSaveDialog).not.toHaveBeenCalled()
    })

    it('refuses to copy when the app was cleared while the dialog stood open', async () => {
      // Taking an app offline does not wait for in-flight calls (design §2.1) and a native
      // dialog can stand open for minutes. Without a lease held across it the copy still
      // ran, putting a file the user had just cleared onto their disk — or, once the blob
      // was reclaimed, failing as an unexplained `Internal`.
      await saved()
      vi.mocked(dialog.showSaveDialog).mockImplementation(async () => {
        generation.value += 1
        return { canceled: false, filePath: '/Users/u/out.txt' }
      })

      await expect(fileCapability.export(A, { name: 'notes.txt' }, SENDER)).rejects.toThrow(MiniAppQuiescingError)
      expect(copyFile).not.toHaveBeenCalled()
    })

    it('refuses to copy a file the app deleted while the dialog stood open', async () => {
      // The lease says nothing here: a `file.delete` moves no generation. The ref has to be
      // resolved a second time, or the export copies a blob whose row is already gone.
      await saved()
      vi.mocked(dialog.showSaveDialog).mockImplementation(async () => {
        await fileCapability.delete(A, { name: 'notes.txt' })
        return { canceled: false, filePath: '/Users/u/out.txt' }
      })

      await expect(fileCapability.export(A, { name: 'notes.txt' }, SENDER)).rejects.toThrow(InvalidArgumentError)
      expect(copyFile).not.toHaveBeenCalled()
    })

    it('rejects a name it does not have without opening a dialog', async () => {
      insertApp(A)

      await expect(fileCapability.export(A, { name: 'missing.txt' }, SENDER)).rejects.toThrow(InvalidArgumentError)
      expect(dialog.showSaveDialog).not.toHaveBeenCalled()
    })

    it('allows one dialog at a time', async () => {
      await saved()
      let finish: (value: Electron.SaveDialogReturnValue) => void = () => {}
      vi.mocked(dialog.showSaveDialog).mockReturnValue(new Promise((resolve) => (finish = resolve)))

      const first = fileCapability.export(A, { name: 'notes.txt' }, SENDER)
      await expect(fileCapability.export(A, { name: 'notes.txt' }, SENDER)).rejects.toThrow(RateLimitedError)

      finish({ canceled: true, filePath: '' })
      await expect(first).resolves.toEqual({ saved: false })
    })
  })
})
