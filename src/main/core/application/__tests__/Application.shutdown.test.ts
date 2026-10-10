/**
 * Shutdown-path tests for the composition root.
 *
 * These live here rather than in LifecycleManager.test.ts because the
 * force-exit fuse is NOT part of shutdown() — it is armed by the `will-quit`
 * handler (and by the signal handlers) around it. Proving that a stuck service
 * no longer costs the process a `process.exit(1)` therefore has to start from
 * that handler, with a real LifecycleManager underneath.
 */

import { mockMainLoggerService } from '@test-mocks/MainLoggerService'
import { app } from 'electron'
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest'

import { bootConfigService } from '@main/data/bootConfig'

import { BaseService } from '../../lifecycle/BaseService'
import { SERVICE_STOP_TIMEOUT_MS, SHUTDOWN_TIMEOUT_MS } from '../../lifecycle/constants'
import { DependsOn, Injectable } from '../../lifecycle/decorators'
import { LifecycleManager } from '../../lifecycle/LifecycleManager'
import { ServiceContainer } from '../../lifecycle/ServiceContainer'
import { Phase } from '../../lifecycle/types'
import { Application } from '../Application'

// The `@application` alias resolves to Application.ts, so the global
// vi.mock('@application') in tests/main.setup.ts would otherwise hand back the
// stub singleton instead of the real class under test.
vi.unmock('@application')

/**
 * Reset the Application singleton between cases.
 *
 * `Application` has no reset API and `isShuttingDown` is one-way: once true,
 * `shutdown()` early-returns forever, so a second scenario would silently not
 * run at all. The private static is cleared directly — same escape hatch the
 * lifecycle tests use for `manager['container']`.
 */
function resetApplication(): void {
  LifecycleManager.reset()
  ServiceContainer.reset()
  BaseService.resetInstances()
  ;(Application as unknown as { instance: Application | null }).instance = null
}

/** The `will-quit` listener Application registered, as Electron would call it. */
type QuitListener = (event: { preventDefault: () => void }) => void

describe('Application shutdown', () => {
  let exitSpy: MockInstance<typeof process.exit>
  let appOn: ReturnType<typeof vi.fn>
  let appExit: ReturnType<typeof vi.fn>

  beforeEach(() => {
    resetApplication()
    vi.useFakeTimers()

    // Extend (not replace) the global electron mock: it ships `getPath` and
    // friends but no `on` / `exit` / `quit`, and we need to capture the
    // listeners Application registers.
    appOn = vi.fn()
    appExit = vi.fn()
    Object.assign(app, { on: appOn, exit: appExit, quit: vi.fn() })

    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never)
    vi.spyOn(bootConfigService, 'flush').mockImplementation(() => {})
    vi.spyOn(mockMainLoggerService, 'finish').mockImplementation(() => {})
    mockMainLoggerService.info.mockClear()
    mockMainLoggerService.warn.mockClear()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    resetApplication()
  })

  /** Messages a mocked logger level received, for `stringContaining` matching. */
  const messages = (level: 'info' | 'warn'): string[] =>
    mockMainLoggerService[level].mock.calls.map((call) => String(call[0]))

  /** An onStop that never settles — the framework has to abandon it. */
  const neverSettles = (): Promise<void> => new Promise<void>(() => {})

  /**
   * Arm the quit handlers, initialize the registered services, and drive the
   * `will-quit` path to completion.
   *
   * The handler is not async — it `preventDefault()`s and kicks off a promise
   * chain — so completion is observed through `app.exit`, which its `.finally`
   * calls. Draining the fake timer queue covers both the per-service ceilings
   * and the force-exit fuse: if the fuse were still armed and due, it would
   * fire here.
   */
  async function runWillQuit(application: Application): Promise<void> {
    application['setupQuitHandlers']()
    await application.getLifecycleManager().startPhase(Phase.WhenReady)

    const willQuit = appOn.mock.calls.find(([event]) => event === 'will-quit')?.[1] as QuitListener
    expect(willQuit).toBeTypeOf('function')

    const preventDefault = vi.fn()
    willQuit({ preventDefault })
    expect(preventDefault).toHaveBeenCalled()

    await vi.runAllTimersAsync()
  }

  it('should not force-exit when a single service times out, and still stop the rest', async () => {
    const stopped: string[] = []

    @Injectable('TailService')
    class TailService extends BaseService {
      protected override onStop() {
        stopped.push('Tail')
      }
    }

    @Injectable('StuckService')
    @DependsOn(['TailService'])
    class StuckService extends BaseService {
      protected override onStop() {
        return neverSettles()
      }
    }

    const application = Application.getInstance()
    ServiceContainer.getInstance().register(TailService)
    ServiceContainer.getInstance().register(StuckService)

    await runWillQuit(application)

    expect(exitSpy).not.toHaveBeenCalled()
    expect(appExit).toHaveBeenCalledWith(0)
    expect(stopped).toEqual(['Tail'])
    expect(messages('warn')).toContainEqual(expect.stringContaining('Shutdown complete, but not cleanly'))
  })

  it('should not force-exit when three services time out', async () => {
    const stopped: string[] = []

    @Injectable('TailService')
    class TailService extends BaseService {
      protected override onStop() {
        stopped.push('Tail')
      }
    }

    @Injectable('StuckOneService')
    @DependsOn(['TailService'])
    class StuckOneService extends BaseService {
      protected override onStop() {
        return neverSettles()
      }
    }

    @Injectable('StuckTwoService')
    @DependsOn(['StuckOneService'])
    class StuckTwoService extends BaseService {
      protected override onStop() {
        return neverSettles()
      }
    }

    @Injectable('StuckThreeService')
    @DependsOn(['StuckTwoService'])
    class StuckThreeService extends BaseService {
      protected override onStop() {
        return neverSettles()
      }
    }

    const application = Application.getInstance()
    const container = ServiceContainer.getInstance()
    container.register(TailService)
    container.register(StuckOneService)
    container.register(StuckTwoService)
    container.register(StuckThreeService)

    await runWillQuit(application)

    // Three services burning their full ceiling still fit inside the fuse.
    expect(exitSpy).not.toHaveBeenCalled()
    expect(appExit).toHaveBeenCalledWith(0)
    expect(stopped).toEqual(['Tail'])
  })

  it('should still fall back to the fuse once enough services exhaust their ceilings', async () => {
    // Positive control for the two cases above: the fuse is not dead code, it is
    // just no longer what ends a normal quit. One more stuck service than the
    // budget can hold is the documented boundary, not a regression.
    const stuckCount = Math.ceil(SHUTDOWN_TIMEOUT_MS / SERVICE_STOP_TIMEOUT_MS) + 1
    const container = ServiceContainer.getInstance()
    for (let i = 0; i < stuckCount; i++) {
      const StuckService = class extends BaseService {
        protected override onStop(): Promise<void> {
          return neverSettles()
        }
      }
      Injectable(`Stuck${i}Service`)(StuckService)
      container.register(StuckService)
    }

    await runWillQuit(Application.getInstance())

    expect(exitSpy).toHaveBeenCalledWith(1)
  })

  it('should keep the flush → stop → destroy → finish order and report a clean exit', async () => {
    const order: string[] = []

    vi.mocked(bootConfigService.flush).mockImplementation(() => {
      order.push('flush')
    })
    vi.mocked(mockMainLoggerService.finish).mockImplementation(() => {
      order.push('finish')
    })

    @Injectable('HealthyService')
    class HealthyService extends BaseService {
      protected override onStop() {
        order.push('stop')
      }
      protected override onDestroy() {
        order.push('destroy')
      }
    }

    const application = Application.getInstance()
    ServiceContainer.getInstance().register(HealthyService)

    await runWillQuit(application)

    expect(order).toEqual(['flush', 'stop', 'destroy', 'finish'])
    expect(exitSpy).not.toHaveBeenCalled()
    expect(messages('info')).toContainEqual(expect.stringContaining('Shutdown complete ('))
    expect(messages('warn')).not.toContainEqual(expect.stringContaining('not cleanly'))
  })
})
