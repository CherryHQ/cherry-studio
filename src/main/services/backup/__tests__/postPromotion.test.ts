import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { application } from '@application'
import { readRestoreJournalV2, writeRestoreJournalV2 } from '@data/db/restore/restoreJournalV2'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { runPostPromotionWork } from '../postPromotion'

const RESTORE_ID = '11111111-2222-4333-8444-555555555555'
const BASE_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
const OTHER_BASE_ID = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff'

describe('post-promotion work', () => {
  let userData = ''
  const reconcile = vi.fn<(baseId: string, restoreId: string) => Promise<'completed' | 'pending'>>()

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'cs-postpromote-'))
    reconcile.mockReset().mockResolvedValue('pending')
    vi.spyOn(application, 'getPath').mockImplementation((key: string) => {
      if (key === 'feature.backup.restore.file') return join(userData, 'restore-journal.json')
      throw new Error(`Unexpected path key in postPromotion test: ${key}`)
    })
    vi.spyOn(application, 'get').mockImplementation(((name: string) => {
      if (name === 'KnowledgeService') return { reconcileRestoredBaseFromMaterial: reconcile }
      throw new Error(`Unexpected service in postPromotion test: ${name}`)
    }) as unknown as typeof application.get)
    writeRestoreJournalV2(journal('completed', [BASE_ID]))
  })

  afterEach(() => {
    rmSync(userData, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  function journal(state: 'completed' | 'failed' | 'prepared', knowledgeBaseIds: string[] = []) {
    const base = {
      version: 2 as const,
      restoreId: RESTORE_ID,
      preset: 'full' as const,
      createdAt: '2026-07-27T00:00:00.000Z',
      db: {
        promote: 'restore-staging/x/backup.sqlite',
        aside: 'cherrystudio.sqlite.pre-restore-x',
        chain: [{ folderMillis: 1_730_000_000_000, hash: 'h' }]
      },
      resourceInstalls: []
    }
    if (state === 'completed') {
      return {
        ...base,
        state,
        ownerSummary: {
          knowledge: { baseIds: knowledgeBaseIds, requiresRebuild: knowledgeBaseIds.length > 0 }
        }
      }
    }
    return { ...base, state }
  }

  it('asks Knowledge to rebuild only the base IDs transported by this restore', async () => {
    const outcome = await runPostPromotionWork(() => true)

    expect(outcome).toEqual({ ran: true, enqueuedBaseIds: [BASE_ID], pending: true })
    expect(reconcile).toHaveBeenCalledWith(BASE_ID, RESTORE_ID)
  })

  it('persists owner-proven completion and skips that base on later passes', async () => {
    reconcile.mockResolvedValue('completed')

    await expect(runPostPromotionWork(() => true)).resolves.toEqual({
      ran: true,
      enqueuedBaseIds: [],
      pending: false
    })
    const read = readRestoreJournalV2()
    expect(read.kind).toBe('ok')
    if (read.kind !== 'ok' || read.journal.state !== 'completed') throw new Error('expected completed journal')
    expect(read.journal.ownerProgress).toEqual({ knowledge: { completedBaseIds: [BASE_ID] } })

    reconcile.mockClear()
    await expect(runPostPromotionWork(() => true)).resolves.toMatchObject({ pending: false })
    expect(reconcile).not.toHaveBeenCalled()
  })

  it('does not restart work the user explicitly abandoned', async () => {
    const completed = journal('completed', [BASE_ID])
    if (completed.state !== 'completed') throw new Error('expected completed journal fixture')
    writeRestoreJournalV2({
      ...completed,
      ownerProgress: { knowledge: { completedBaseIds: [], abandoned: true } }
    })

    await expect(runPostPromotionWork(() => true)).resolves.toEqual({
      ran: true,
      enqueuedBaseIds: [],
      pending: false
    })
    expect(reconcile).not.toHaveBeenCalled()
  })

  it('does no Knowledge work for a restore that transported no bases', async () => {
    writeRestoreJournalV2(journal('completed', []))

    const outcome = await runPostPromotionWork(() => true)

    expect(outcome).toEqual({ ran: true, enqueuedBaseIds: [], pending: false })
    expect(reconcile).not.toHaveBeenCalled()
  })

  it.each(['failed', 'prepared'] as const)('does nothing when the last restore is %s', async (state) => {
    writeRestoreJournalV2(journal(state))

    const outcome = await runPostPromotionWork(() => true)

    expect(outcome).toEqual({ ran: false, enqueuedBaseIds: [], pending: false })
    expect(reconcile).not.toHaveBeenCalled()
  })

  it('keeps durable work pending when shutdown arrives before a pass', async () => {
    const outcome = await runPostPromotionWork(() => false)

    expect(outcome).toEqual({ ran: true, enqueuedBaseIds: [], pending: true })
    expect(reconcile).not.toHaveBeenCalled()
  })

  it('isolates one failing base and still records completion for another', async () => {
    writeRestoreJournalV2(journal('completed', [BASE_ID, OTHER_BASE_ID]))
    reconcile.mockImplementation(async (baseId) => {
      if (baseId === BASE_ID) throw new Error('base is blocked')
      return 'completed'
    })

    const outcome = await runPostPromotionWork(() => true)

    expect(outcome).toEqual({ ran: true, enqueuedBaseIds: [BASE_ID], pending: true })
    const read = readRestoreJournalV2()
    expect(read.kind).toBe('ok')
    if (read.kind !== 'ok' || read.journal.state !== 'completed') throw new Error('expected completed journal')
    expect(read.journal.ownerProgress).toEqual({ knowledge: { completedBaseIds: [OTHER_BASE_ID] } })
  })

  it('preserves another owner progress entry when Knowledge completes', async () => {
    const completed = journal('completed', [BASE_ID])
    if (completed.state !== 'completed') throw new Error('expected completed journal fixture')
    writeRestoreJournalV2({
      ...completed,
      ownerProgress: { futureOwner: { cursor: 7 } }
    })
    reconcile.mockResolvedValue('completed')

    await runPostPromotionWork(() => true)

    const read = readRestoreJournalV2()
    expect(read).toMatchObject({
      kind: 'ok',
      journal: {
        ownerProgress: {
          futureOwner: { cursor: 7 },
          knowledge: { completedBaseIds: [BASE_ID] }
        }
      }
    })
  })
})
