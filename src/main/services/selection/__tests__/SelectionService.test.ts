// @application, electron, and @logger are globally mocked in tests/main.setup.ts.
import { application } from '@application'
import { BaseService } from '@main/core/lifecycle/BaseService'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { SelectionService } = await import('../SelectionService')

// Reach the protected onAllReady/activate without widening the public surface.
type TestableSelectionService = InstanceType<typeof SelectionService> & {
  onAllReady(): void
  activate(): Promise<boolean>
  deactivate(): Promise<boolean>
}

/** Drain the setImmediate queue so the deferred warm-up runs. */
const flushImmediate = () => new Promise((resolve) => setImmediate(resolve))

describe('SelectionService.onAllReady — deferred warm-up', () => {
  let svc: TestableSelectionService
  let prefGet: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    BaseService.resetInstances()
    svc = new SelectionService() as TestableSelectionService
    prefGet = vi.spyOn(application.get('PreferenceService') as { get: (key: string) => unknown }, 'get')
  })

  afterEach(() => {
    BaseService.resetInstances()
    vi.restoreAllMocks()
  })

  /**
   * Wire activate/deactivate to a local flag and expose it through the `isActivated` getter the
   * reconciler reads, so a successful apply actually converges the snapshot (no spin loop). Returns
   * the activate spy.
   */
  const wireActivation = () => {
    let activated = false
    const activate = vi.spyOn(svc, 'activate').mockImplementation(async () => {
      activated = true
      return true
    })
    vi.spyOn(svc, 'deactivate').mockImplementation(async () => {
      activated = false
      return true
    })
    vi.spyOn(svc, 'isActivated', 'get').mockImplementation(() => activated)
    return activate
  }

  it('defers activation past the boot critical path when the feature is enabled', async () => {
    prefGet.mockReturnValue(true)
    const activate = wireActivation()

    svc.onAllReady()

    // Must NOT activate synchronously — the native addon load + window creation
    // would otherwise stall the concurrent main-window paint.
    expect(activate).not.toHaveBeenCalled()

    await flushImmediate()
    expect(activate).toHaveBeenCalledTimes(1)
  })

  it('skips activation entirely when the feature is disabled', async () => {
    prefGet.mockReturnValue(false)
    const activate = wireActivation()

    svc.onAllReady()
    await flushImmediate()

    expect(activate).not.toHaveBeenCalled()
  })

  it('stays deactivated when the feature is disabled before the deferred warm-up applies', async () => {
    // Enabled at onAllReady time, so the warm-up is scheduled.
    prefGet.mockImplementation((key) => key === 'feature.selection.enabled')
    const activate = wireActivation()

    await svc._doInit() // registers the `feature.selection.enabled` subscription
    const subscribeChange = (
      application.get('PreferenceService') as unknown as { subscribeChange: ReturnType<typeof vi.fn> }
    ).subscribeChange
    const enabledHandler = subscribeChange.mock.calls.find((call) => call[0] === 'feature.selection.enabled')?.[1] as
      | ((enabled: boolean) => void)
      | undefined
    expect(enabledHandler).toBeDefined()

    svc.onAllReady() // enabled → schedules the deferred warm-up

    // The user disables before the deferred warm-up fires. The old code activated unconditionally
    // from the setImmediate; the reconciler re-reads the desired state and never activates.
    enabledHandler!(false)

    await flushImmediate()

    expect(activate).not.toHaveBeenCalled()
    expect(svc.isActivated).toBe(false)
  })
})
