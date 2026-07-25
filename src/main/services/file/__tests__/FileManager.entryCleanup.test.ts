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

// The scheduled FS orphan sweep rides this same tick; stub it so the wiring is
// observable without touching the filesystem.
const { fileSweepMock } = vi.hoisted(() => ({ fileSweepMock: vi.fn() }))
vi.mock('../internal/orphanSweep', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  runFileSweep: (...args: unknown[]) => fileSweepMock(...args)
}))

const { BaseService } = await import('@main/core/lifecycle')
const { FileManager } = await import('../FileManager')

type Report = Awaited<ReturnType<InstanceType<typeof FileManager>['runEntryCleanup']>>

function completedReport(overrides: Partial<Report> = {}): Report {
  return {
    outcome: 'completed',
    candidates: 0,
    deleted: 0,
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
    fileSweepMock.mockReset()
    fileSweepMock.mockResolvedValue({ outcome: 'completed' })
    BaseService.resetInstances()
    fm = new FileManager()
  })

  it('onInit runs an ungated backlog pass and registers the 30-minute interval', async () => {
    // The init pass is deliberately NOT idle-gated: it drains the previous
    // session's backlog (crashed sends, pre-upgrade leaks), which the first
    // interval tick would otherwise defer behind the idle threshold.
    powerState.idleSeconds = 0
    const cleanup = vi.spyOn(fm, 'runEntryCleanup').mockResolvedValue(completedReport())
    const internals = fm as unknown as {
      registerInterval(fn: () => void, ms: number): unknown
      registerIpcHandlers(): void
      deps: { danglingCache: { initFromDb(): Promise<void> } }
      onInit(): Promise<void>
    }
    const registerInterval = vi.spyOn(internals, 'registerInterval').mockReturnValue(undefined)
    vi.spyOn(internals, 'registerIpcHandlers').mockImplementation(() => undefined)
    vi.spyOn(internals.deps.danglingCache, 'initFromDb').mockResolvedValue(undefined)

    await internals.onInit()

    expect(cleanup).toHaveBeenCalledTimes(1)
    expect(registerInterval).toHaveBeenCalledWith(expect.any(Function), 30 * 60 * 1000)
  })

  it('sweeps orphan blobs on the first idle tick, then holds off for a week', async () => {
    // `runSweep()` (the File_RunSweep IPC) has no renderer caller, so this tick
    // is what actually reclaims blobs the cleanup pass strands via unlinkFailures
    // or a crash between row delete and unlink.
    powerState.idleSeconds = 120
    vi.spyOn(fm, 'runEntryCleanup').mockResolvedValue(completedReport())
    const tick = (fm as unknown as { entryCleanupTick(): Promise<void> }).entryCleanupTick.bind(fm)

    await tick()
    expect(fileSweepMock).toHaveBeenCalledTimes(1)

    await tick()
    expect(fileSweepMock).toHaveBeenCalledTimes(1)

    // Move the last sweep back past the weekly floor — the next tick sweeps again.
    ;(fm as unknown as { lastFileSweepAt: number }).lastFileSweepAt = Date.now() - 8 * 24 * 60 * 60 * 1000
    await tick()
    expect(fileSweepMock).toHaveBeenCalledTimes(2)
  })

  it('does not sweep orphan blobs when the tick itself is gated out', async () => {
    powerState.idleSeconds = 5
    vi.spyOn(fm, 'runEntryCleanup').mockResolvedValue(completedReport())
    ;(fm as unknown as { lastCleanupCompletedAt: number }).lastCleanupCompletedAt = Date.now()

    await (fm as unknown as { entryCleanupTick(): Promise<void> }).entryCleanupTick()

    expect(fileSweepMock).not.toHaveBeenCalled()
  })

  it('keeps the tick alive when the orphan sweep throws', async () => {
    // Hygiene must never break the tick that also runs entry cleanup.
    powerState.idleSeconds = 120
    fileSweepMock.mockRejectedValue(new Error('readdir boom'))
    const cleanup = vi.spyOn(fm, 'runEntryCleanup').mockResolvedValue(completedReport())

    await expect((fm as unknown as { entryCleanupTick(): Promise<void> }).entryCleanupTick()).resolves.toBeUndefined()

    expect(cleanup).toHaveBeenCalledTimes(1)
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
