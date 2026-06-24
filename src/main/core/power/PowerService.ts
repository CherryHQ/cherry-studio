import { application } from '@application'
import { loggerService } from '@logger'
import {
  BaseService,
  type Disposable,
  Emitter,
  type Event,
  Injectable,
  Phase,
  ServicePhase
} from '@main/core/lifecycle'
import { isLinux, isMac, isWin } from '@main/core/platform'
import ElectronShutdownHandler from '@paymoapp/electron-shutdown-handler'
import { BrowserWindow, powerMonitor, powerSaveBlocker } from 'electron'

const logger = loggerService.withContext('PowerService')

/**
 * Hard cap on how long registered shutdown handlers may block OS shutdown.
 * After this elapses we force the quit regardless, so a hung handler can never
 * leave the user's machine unable to shut down.
 */
const SHUTDOWN_HANDLER_TIMEOUT_MS = 5000

export type PowerSource = 'ac' | 'battery' | 'unknown'
export type SystemIdleState = 'active' | 'idle' | 'locked' | 'unknown'
export type PowerPhase = 'active' | 'suspended'

type ShutdownHandler = () => void | Promise<void>

/**
 * System power hub.
 *
 * Centralizes every Electron `powerMonitor` / `powerSaveBlocker` concern behind one
 * lifecycle-managed service:
 *
 *  - Notification events (suspend/resume/lock/unlock/power-source) as typed Emitters.
 *    suspend/resume and power-source are de-duplicated against internal state (macOS
 *    fires suspend/resume twice — electron/electron#24803); lock/unlock are pass-through.
 *  - A bounded, cross-platform shutdown barrier: handlers run to completion (or a hard
 *    timeout) before the app quits, so cleanup is not truncated by OS shutdown.
 *  - Sleep prevention via a ref-counted hold registry. Any worker that must keep the
 *    machine awake registers a hold; the OS blocker is active only while at least one
 *    hold is held AND the user has opted in (`app.power.prevent_sleep_when_busy`).
 *  - Level-triggered queries (idle time/state, power source, phase) so a late subscriber
 *    can reconcile current state without having observed the edge.
 *
 * WhenReady phase: the app is already ready, so `powerSaveBlocker` / `BrowserWindow`
 * are usable directly (no `app.whenReady()` gymnastics). The preference gate is
 * self-read here, mirroring TrayService/ThemeService/ProxyManager.
 */
@Injectable('PowerService')
@ServicePhase(Phase.WhenReady)
export class PowerService extends BaseService {
  // ── Notification events ──────────────────────────────────────────────
  private readonly _onSuspend: Emitter<void>
  public readonly onSuspend: Event<void>
  private readonly _onResume: Emitter<void>
  public readonly onResume: Event<void>
  private readonly _onLockScreen: Emitter<void>
  public readonly onLockScreen: Event<void>
  private readonly _onUnlockScreen: Emitter<void>
  public readonly onUnlockScreen: Event<void>
  private readonly _onPowerSourceChange: Emitter<PowerSource>
  public readonly onPowerSourceChange: Event<PowerSource>

  // ── De-dup state (suspend/resume + power source) ──────────────────────
  private powerPhase: PowerPhase = 'active'
  private powerSource: PowerSource = 'unknown'

  // ── Shutdown barrier ──────────────────────────────────────────────────
  private shutdownHandlers: ShutdownHandler[] = []

  // ── Sleep prevention ──────────────────────────────────────────────────
  // token Map (not a bare counter): dispose is idempotent and the holds are
  // enumerable for diagnosing a leak ("who is holding, and since when").
  private readonly holds = new Map<symbol, { reason?: string; since: number }>()
  private preventEnabled = false
  private blockerId: number | null = null

  constructor() {
    super()
    this._onSuspend = this.registerDisposable(new Emitter<void>())
    this.onSuspend = this._onSuspend.event
    this._onResume = this.registerDisposable(new Emitter<void>())
    this.onResume = this._onResume.event
    this._onLockScreen = this.registerDisposable(new Emitter<void>())
    this.onLockScreen = this._onLockScreen.event
    this._onUnlockScreen = this.registerDisposable(new Emitter<void>())
    this.onUnlockScreen = this._onUnlockScreen.event
    this._onPowerSourceChange = this.registerDisposable(new Emitter<PowerSource>())
    this.onPowerSourceChange = this._onPowerSourceChange.event
  }

  protected onInit(): void {
    this.initPowerEvents()
    this.initShutdownBarrier()
    this.initSleepPrevention()
    logger.info('PowerService initialized', { platform: process.platform })
  }

  protected onStop(): void {
    this.shutdownHandlers = []
    if (this.blockerId !== null) {
      powerSaveBlocker.stop(this.blockerId)
      this.blockerId = null
    }
    this.holds.clear()
    logger.info('PowerService stopped')
  }

  // ==========================================================================
  // Power notification events
  // ==========================================================================

  private initPowerEvents(): void {
    // Seed the power source from the current state so the first query / event is correct.
    this.powerSource = powerMonitor.onBatteryPower ? 'battery' : 'ac'

    const onSuspend = () => {
      if (this.powerPhase === 'suspended') return // de-dup (macOS double-fires — electron#24803)
      this.powerPhase = 'suspended'
      this._onSuspend.fire()
    }
    const onResume = () => {
      if (this.powerPhase === 'active') return
      this.powerPhase = 'active'
      this._onResume.fire()
    }
    // lock/unlock are pass-through forwards — no state machine (nothing to de-dup).
    const onLockScreen = () => this._onLockScreen.fire()
    const onUnlockScreen = () => this._onUnlockScreen.fire()
    const onAc = () => this.updatePowerSource('ac')
    const onBattery = () => this.updatePowerSource('battery')

    powerMonitor.on('suspend', onSuspend)
    powerMonitor.on('resume', onResume)
    powerMonitor.on('lock-screen', onLockScreen)
    powerMonitor.on('unlock-screen', onUnlockScreen)
    powerMonitor.on('on-ac', onAc)
    powerMonitor.on('on-battery', onBattery)

    this.registerDisposable(() => {
      powerMonitor.removeListener('suspend', onSuspend)
      powerMonitor.removeListener('resume', onResume)
      powerMonitor.removeListener('lock-screen', onLockScreen)
      powerMonitor.removeListener('unlock-screen', onUnlockScreen)
      powerMonitor.removeListener('on-ac', onAc)
      powerMonitor.removeListener('on-battery', onBattery)
    })
  }

  private updatePowerSource(source: PowerSource): void {
    if (this.powerSource === source) return
    this.powerSource = source
    this._onPowerSourceChange.fire(source)
  }

  // ==========================================================================
  // Shutdown barrier (bounded, cross-platform)
  // ==========================================================================

  private initShutdownBarrier(): void {
    if (isWin) {
      this.initWindowsShutdownHandler()
    } else if (isMac || isLinux) {
      this.initElectronShutdownHandler()
    }
  }

  /**
   * Register a handler to run when the OS reports an impending shutdown.
   * Handlers run serially and are bounded by {@link SHUTDOWN_HANDLER_TIMEOUT_MS}.
   * Returns a Disposable to unregister; handlers are also cleared on service stop.
   */
  public registerShutdownHandler(handler: ShutdownHandler): Disposable {
    this.shutdownHandlers.push(handler)
    logger.info('Shutdown handler registered', { totalHandlers: this.shutdownHandlers.length })
    return {
      dispose: () => {
        const idx = this.shutdownHandlers.indexOf(handler)
        if (idx !== -1) this.shutdownHandlers.splice(idx, 1)
      }
    }
  }

  /** Run all handlers serially, error-isolated, capped by a hard timeout. */
  private async executeShutdownHandlers(): Promise<void> {
    logger.info('Executing shutdown handlers', { count: this.shutdownHandlers.length })
    const run = (async () => {
      for (const handler of this.shutdownHandlers) {
        try {
          await handler()
        } catch (error) {
          logger.error('Error executing shutdown handler', error as Error)
        }
      }
    })()

    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<void>((resolve) => {
      timer = setTimeout(() => {
        logger.warn('Shutdown handlers timed out — proceeding with quit', { timeoutMs: SHUTDOWN_HANDLER_TIMEOUT_MS })
        resolve()
      }, SHUTDOWN_HANDLER_TIMEOUT_MS)
    })

    try {
      await Promise.race([run, timeout])
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  private initElectronShutdownHandler(): void {
    // On macOS/Linux the listener receives an event; preventDefault() lets us delay
    // shutdown to run handlers cleanly, after which WE must quit the app ourselves.
    // NOTE: Electron's type for the 'shutdown' listener is `() => void` (it omits the
    // event arg), but the runtime DOES pass an event with preventDefault — see the
    // electron.d.ts doc comment on this event. We declare the arg optional so the
    // signature stays assignable to the typed overload while still using preventDefault.
    const shutdownListener = async (event?: Electron.Event) => {
      logger.info('System shutdown event detected', { platform: process.platform })
      event?.preventDefault()
      try {
        await this.executeShutdownHandlers()
      } finally {
        // application.quit() maintains the app's _isQuitting bookkeeping (not bare app.quit()).
        application.quit()
      }
    }
    powerMonitor.on('shutdown', shutdownListener)
    this.registerDisposable(() => powerMonitor.removeListener('shutdown', shutdownListener))
    logger.info('Electron powerMonitor shutdown listener registered')
  }

  private initWindowsShutdownHandler(): void {
    try {
      // The native addon hooks Windows shutdown messages (WM_QUERYENDSESSION) on a real
      // window handle (HWND). We deliberately create our OWN hidden window rather than
      // reuse the main window: the main window is a singleton that can be destroyed and
      // rebuilt (yielding a new HWND), may not exist yet when this service inits, and
      // reaching into it would couple core/power to the main-window lifecycle. A
      // self-owned window guarantees a stable HWND for the service's whole lifetime.
      // Minimal footprint: we only need the native HWND and never load any content.
      // Because no content is loaded AND `paintWhenInitiallyHidden: false` keeps the renderer
      // from activating/painting, Electron spawns NO separate renderer process for this window
      // — that is the real lever, NOT the window size (dimensions don't affect memory, and
      // width/height: 0 just get clamped to a platform minimum). `skipTaskbar` hides the entry.
      // Measured marginal cost on an already-running app (window subsystem already initialized
      // by the main window): ~0.7 MB RSS and 0 extra processes — effectively free. (The ~40 MB
      // seen when the FIRST-ever BrowserWindow is created is one-time subsystem init the app
      // already pays for its main window, not a per-window cost.)
      const shutdownHookWindow = new BrowserWindow({
        show: false,
        paintWhenInitiallyHidden: false,
        skipTaskbar: true
      })
      ElectronShutdownHandler.setWindowHandle(shutdownHookWindow.getNativeWindowHandle())

      ElectronShutdownHandler.on('shutdown', async () => {
        logger.info('System shutdown event detected (Windows)')
        try {
          await this.executeShutdownHandlers()
        } finally {
          // Release the block so Windows may proceed, then quit cleanly (mirrors the
          // macOS/Linux preventDefault → quit path; quit keeps _isQuitting bookkeeping).
          ElectronShutdownHandler.releaseShutdown()
          application.quit()
        }
      })

      // Actually delay shutdown until releaseShutdown(). Without this the addon only
      // observes the event and does NOT hold the OS — this is what makes the Windows
      // path a real barrier, symmetric with preventDefault() on macOS/Linux. Must be
      // called after the listener is attached (the listener is what installs the hook).
      ElectronShutdownHandler.blockShutdown('Cherry Studio is finishing background work')

      this.registerDisposable(() => {
        if (!shutdownHookWindow.isDestroyed()) shutdownHookWindow.destroy()
      })

      logger.info('Windows shutdown handler registered')
    } catch (error) {
      logger.error('Failed to initialize Windows shutdown handler', error as Error)
    }
  }

  // ==========================================================================
  // Sleep prevention (ref-counted holds + self-read preference gate)
  // ==========================================================================

  private initSleepPrevention(): void {
    const pref = application.get('PreferenceService')
    this.preventEnabled = pref.get('app.power.prevent_sleep_when_busy')
    this.applyBlockerState()
    this.registerDisposable(
      pref.subscribeChange('app.power.prevent_sleep_when_busy', (value) => {
        this.preventEnabled = value
        this.applyBlockerState()
      })
    )
  }

  /**
   * Single idempotent convergence point for the OS blocker. NEVER throws — a
   * `powerSaveBlocker` failure is logged and swallowed (sleep prevention is best-effort),
   * so every caller (preventSleep, dispose, the preference subscription, onStop) is safe.
   */
  private applyBlockerState(): void {
    const shouldBlock = this.preventEnabled && this.holds.size > 0
    try {
      if (shouldBlock && this.blockerId === null) {
        // 'prevent-app-suspension' keeps the system running but allows the display to
        // sleep — correct for background work (jobs/downloads), unlike 'prevent-display-sleep'.
        this.blockerId = powerSaveBlocker.start('prevent-app-suspension')
        logger.info('Sleep prevention activated', { holds: this.holds.size })
      } else if (!shouldBlock && this.blockerId !== null) {
        powerSaveBlocker.stop(this.blockerId)
        this.blockerId = null
        logger.info('Sleep prevention released')
      }
    } catch (err) {
      // Best-effort: never let an OS-blocker failure propagate to callers. Consequence:
      // the blocker may not match intent right now — the machine could sleep while work is
      // running (start failed) or stay awake after work ends (stop failed). Not fatal: the
      // next preventSleep/dispose/preference change re-runs this convergence and can recover.
      logger.warn('powerSaveBlocker state change failed; sleep prevention may be temporarily ineffective', err as Error)
    }
  }

  /**
   * Request that the system stay awake while the returned hold is held. Mirrors the
   * `Application.preventQuit(reason)` hold idiom — and like it, this is a request, not a
   * hard guarantee: sleep is actually prevented only while a hold is held AND the user
   * enabled `app.power.prevent_sleep_when_busy`. Call dispose() when the work finishes.
   *
   * NEVER throws and ALWAYS returns a usable Disposable: any OS-blocker failure is
   * swallowed and logged inside applyBlockerState, so callers need no defensive guard.
   */
  public preventSleep(reason?: string): Disposable {
    const token = Symbol(reason ?? 'sleep-prevention')
    this.holds.set(token, { reason, since: Date.now() })
    this.applyBlockerState()
    return {
      dispose: () => {
        // Map.delete returns false on a second call → dispose is idempotent.
        if (this.holds.delete(token)) this.applyBlockerState()
      }
    }
  }

  /** Whether sleep is currently being prevented (gate enabled AND a hold is held). */
  public isPreventingSleep(): boolean {
    return this.preventEnabled && this.holds.size > 0
  }

  // ==========================================================================
  // Queries (level-triggered)
  // ==========================================================================

  public getPowerPhase(): PowerPhase {
    return this.powerPhase
  }

  public getPowerSource(): PowerSource {
    return this.powerSource
  }

  public isOnBatteryPower(): boolean {
    return powerMonitor.onBatteryPower
  }

  /** Idle time in seconds. Unlocks the Job `after-idle` catch-up strategy (later). */
  public getSystemIdleTime(): number {
    return powerMonitor.getSystemIdleTime()
  }

  public getSystemIdleState(idleThresholdSec: number): SystemIdleState {
    return powerMonitor.getSystemIdleState(idleThresholdSec)
  }
}
