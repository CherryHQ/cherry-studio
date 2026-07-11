/**
 * Idle-gated interval tick for FileManager's entry-cleanup wiring
 * (docs/references/file/file-entry-cleanup.md §5.5). Uses a light
 * instantiate-and-spy harness rather than the DB-backed integration harness
 * (FileManager.integration.test.ts) — these tests gate the TICK logic only;
 * the cleanup pass itself is covered by entryCleanup.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

// PowerService is not a default mock service, so wrap `get` to return a
// controllable idle-time stub. `powerState.idleSeconds` is mutated per test.
const { powerState } = vi.hoisted(() => ({ powerState: { idleSeconds: 0 } }))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  const result = mockApplicationFactory()
  const originalGet = result.application.get.getMockImplementation()!
  result.application.get.mockImplementation((name: string) => {
    if (name === 'PowerService') {
      return { getSystemIdleTime: () => powerState.idleSeconds }
    }
    return originalGet(name)
  })
  return result
})

const { BaseService } = await import('@main/core/lifecycle')
const { FileManager } = await import('../FileManager')

type Report = Awaited<ReturnType<InstanceType<typeof FileManager>['runEntryCleanup']>>

function completedReport(overrides: Partial<Report> = {}): Report {
  return {
    outcome: 'completed',
    candidates: 0,
    deleted: 0,
    skippedTempRefs: 0,
    skippedRefsReappeared: 0,
    gonePinned: 0,
    failed: 0,
    unlinkFailures: 0,
    durationMs: 0,
    ...overrides
  }
}

describe('FileManager entry-cleanup wiring', () => {
  let fm: InstanceType<typeof FileManager>

  beforeEach(() => {
    powerState.idleSeconds = 0
    BaseService.resetInstances()
    fm = new FileManager()
  })

  it('interval tick skips when the user is active and lastRun is recent', async () => {
    powerState.idleSeconds = 5
    const spy = vi.spyOn(fm, 'runEntryCleanup').mockResolvedValue(completedReport())
    ;(fm as unknown as { lastCleanupCompletedAt: number }).lastCleanupCompletedAt = Date.now()

    await (fm as unknown as { entryCleanupTick(): Promise<void> }).entryCleanupTick()

    expect(spy).not.toHaveBeenCalled()
  })

  it('interval tick runs when idle', async () => {
    powerState.idleSeconds = 120
    const spy = vi.spyOn(fm, 'runEntryCleanup').mockResolvedValue(completedReport())

    await (fm as unknown as { entryCleanupTick(): Promise<void> }).entryCleanupTick()

    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('interval tick runs despite activity when 2h overdue', async () => {
    powerState.idleSeconds = 5
    const spy = vi.spyOn(fm, 'runEntryCleanup').mockResolvedValue(completedReport())
    ;(fm as unknown as { lastCleanupCompletedAt: number }).lastCleanupCompletedAt = Date.now() - 3 * 60 * 60 * 1000

    await (fm as unknown as { entryCleanupTick(): Promise<void> }).entryCleanupTick()

    expect(spy).toHaveBeenCalledTimes(1)
  })
})
