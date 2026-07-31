import { Cron } from 'croner'

import { loggerService } from '@logger'
import { BaseService, type Disposable, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import type { Trigger } from '@shared/data/api/schemas/jobs'

const logger = loggerService.withContext('SchedulerService')

/**
 * setTimeout clamps delays above 2^31-1 ms to fire (near-)immediately, which
 * would turn a chained interval into a hot loop and a far-future once into an
 * early fire. `validateTrigger` rejects intervals beyond this bound.
 */
const MAX_TIMER_DELAY_MS = 2 ** 31 - 1

export type ScheduleCallback = () => void | Promise<void>

interface IntervalEntry {
  handle: ReturnType<typeof setTimeout>
  ms: number
  callback: ScheduleCallback
}

/**
 * General-purpose stateless scheduler. Knows about "when" to fire a callback,
 * nothing about what the callback does. JobManager is its primary consumer but
 * any business module can use it directly for simple cron/interval/once needs.
 *
 * See `docs/references/job-and-scheduler/scheduler-usage.md` for the decision
 * tree on when to use this vs `BaseService.registerInterval` vs raw setInterval.
 *
 * Internals:
 *   - `cron` Triggers are backed by croner instances (pause/resume, timezone
 *     via Intl API, .trigger() for manual fire, `protect: true` blocks
 *     overlapping fires when async callbacks run long).
 *   - `once` Triggers use a single setTimeout that self-removes from the map
 *     before invoking the callback (re-entrant-safe).
 *   - `interval` Triggers use a chained setTimeout — handles slow callbacks
 *     without overlap and unrefs the loop. pause/resume are no-ops for these
 *     (callers should unregister + re-register to "pause"); the method warns.
 *   - No persistence. Re-register everything in `onReady` of each consumer
 *     after process restart.
 */
@Injectable('SchedulerService')
@ServicePhase(Phase.WhenReady)
export class SchedulerService extends BaseService {
  private cronJobs = new Map<string, Cron>()
  private intervalHandles = new Map<string, IntervalEntry>()

  protected override onInit(): void {
    logger.info('SchedulerService initialized')
  }

  protected override onStop(): void {
    this.clearAll()
  }

  protected override onDestroy(): void {
    this.clearAll()
  }

  /**
   * Parse-only validation of a trigger's scheduling semantics — nothing is
   * registered and no timer is created. Cron expressions and IANA timezones go
   * through the same Croner construction path as `scheduleCron` (constructed
   * without a callback, so nothing is scheduled; `nextRun()` forces the
   * timezone conversion Croner otherwise defers; `.stop()` is defensive),
   * surfacing the parser's original error. Delays beyond the setTimeout limit
   * are rejected — Node would fire the timer immediately, turning a chained
   * interval into a hot loop and a far-future once into an early fire. The
   * once bound only needs to hold at validation time: the remaining delay
   * shrinks monotonically, so every later re-arm stays under the limit too.
   *
   * @param trigger - Trigger config to validate
   * @throws The raw Croner / Intl parse error for an invalid cron expression
   *   or unknown timezone; `RangeError` for an out-of-range interval / once
   */
  validateTrigger(trigger: Trigger): void {
    if (trigger.kind === 'cron') {
      const probe = new Cron(trigger.expr, { timezone: trigger.timezone, maxRuns: trigger.limit })
      probe.nextRun()
      probe.stop()
      return
    }
    if (trigger.kind === 'interval' && trigger.ms > MAX_TIMER_DELAY_MS) {
      throw new RangeError(`interval of ${trigger.ms} ms exceeds the maximum timer delay (${MAX_TIMER_DELAY_MS} ms)`)
    }
    if (trigger.kind === 'once' && trigger.at - Date.now() > MAX_TIMER_DELAY_MS) {
      throw new RangeError(`once trigger is more than ${MAX_TIMER_DELAY_MS} ms in the future`)
    }
  }

  /**
   * Register a callback to fire on schedule. Calling `registerSchedule` twice
   * with the same `id` replaces the previous registration (the old timer is
   * stopped first).
   *
   * @param id - Unique identifier for this schedule; reused for `pause` / `resume` / `unregister` / `triggerNow`
   * @param trigger - Cron expression, repeating interval, or one-shot delay
   * @param callback - Function invoked on each fire; async callbacks are awaited (cron uses `protect: true` to block overlap)
   * @returns Disposable that unregisters when disposed; the service also auto-cleans on `onStop`
   */
  registerSchedule(id: string, trigger: Trigger, callback: ScheduleCallback): Disposable {
    if (this.has(id)) this.unregister(id)

    if (trigger.kind === 'cron') {
      this.scheduleCron(id, trigger, callback)
    } else if (trigger.kind === 'once') {
      this.scheduleOnce(id, trigger.at, callback)
    } else {
      this.scheduleInterval(id, trigger.ms, callback)
    }

    logger.debug('Scheduled', { id, kind: trigger.kind })
    return { dispose: () => this.unregister(id) }
  }

  /**
   * Pause a cron schedule. No-op (with warn log) for `interval` / `once`:
   * those use chained setTimeout and cannot be paused — to "pause" them,
   * unregister and re-register when ready.
   *
   * @param id - Schedule identifier passed to `registerSchedule`
   */
  pause(id: string): void {
    const cron = this.cronJobs.get(id)
    if (cron) {
      cron.pause()
      logger.debug('Paused cron', { id })
      return
    }
    if (this.intervalHandles.has(id)) {
      logger.warn('pause is a no-op for interval/once schedules — use unregister + re-register to "pause" instead', {
        id
      })
      return
    }
    logger.warn('pause called on unknown schedule id', { id })
  }

  /**
   * Resume a previously paused cron schedule. No-op (with warn log) for
   * `interval` / `once` schedules and unknown ids.
   *
   * @param id - Schedule identifier passed to `registerSchedule`
   */
  resume(id: string): void {
    const cron = this.cronJobs.get(id)
    if (cron) {
      cron.resume()
      logger.debug('Resumed cron', { id })
      return
    }
    if (this.intervalHandles.has(id)) {
      logger.warn('resume is a no-op for interval/once schedules', { id })
      return
    }
    logger.warn('resume called on unknown schedule id', { id })
  }

  /**
   * Stop a schedule and remove it from the registry. Idempotent — unknown
   * ids are silently ignored. Prefer disposing the `Disposable` returned by
   * `registerSchedule` when ownership is local.
   *
   * @param id - Schedule identifier passed to `registerSchedule`
   */
  unregister(id: string): void {
    const cron = this.cronJobs.get(id)
    if (cron) {
      cron.stop()
      this.cronJobs.delete(id)
      logger.debug('Unregistered cron', { id })
      return
    }
    const interval = this.intervalHandles.get(id)
    if (interval) {
      clearTimeout(interval.handle)
      this.intervalHandles.delete(id)
      logger.debug('Unregistered interval/once', { id })
    }
  }

  /**
   * Fire a cron schedule immediately as an extra one-shot — does not affect
   * the natural fire calendar. Awaits croner's `.trigger()` so the caller
   * observes the callback completing. Not supported for `interval` / `once`
   * schedules (they have no croner backing).
   *
   * @param id - Schedule identifier passed to `registerSchedule`
   * @returns `true` if a cron schedule was triggered; `false` if `id` is unknown or not a cron
   */
  async triggerNow(id: string): Promise<boolean> {
    const cron = this.cronJobs.get(id)
    if (!cron) {
      logger.warn('triggerNow only supported for cron schedules', { id })
      return false
    }
    await cron.trigger()
    return true
  }

  /**
   * Next scheduled fire time for a cron schedule.
   *
   * @param id - Schedule identifier passed to `registerSchedule`
   * @returns The next fire `Date`, or `null` for unknown id or non-cron triggers
   */
  getNextRun(id: string): Date | null {
    const cron = this.cronJobs.get(id)
    if (cron) return cron.nextRun() ?? null
    return null
  }

  /**
   * @param id - Schedule identifier
   * @returns `true` if a schedule with this id is registered (any kind)
   */
  has(id: string): boolean {
    return this.cronJobs.has(id) || this.intervalHandles.has(id)
  }

  // ---------------- Private ----------------

  private scheduleCron(id: string, trigger: Extract<Trigger, { kind: 'cron' }>, callback: ScheduleCallback): void {
    const job = new Cron(
      trigger.expr,
      {
        protect: true,
        maxRuns: trigger.limit,
        timezone: trigger.timezone,
        catch: (err) => logger.error('cron callback error', { id, error: err })
      },
      callback
    )
    this.cronJobs.set(id, job)
  }

  private scheduleOnce(id: string, atMs: number, callback: ScheduleCallback): void {
    const delay = Math.max(0, atMs - Date.now())
    const handle = setTimeout(async () => {
      // Self-clean before invoking so a re-entrant registerSchedule(id, ...)
      // from inside the callback can install a new entry without conflict.
      this.intervalHandles.delete(id)
      try {
        await callback()
      } catch (err) {
        logger.error('once-schedule callback error', { id, error: err })
      }
    }, delay)
    handle.unref?.()
    this.intervalHandles.set(id, { handle, ms: delay, callback })
  }

  private scheduleInterval(id: string, ms: number, callback: ScheduleCallback): void {
    const fire = async (): Promise<void> => {
      try {
        await callback()
      } catch (err) {
        logger.error('interval-schedule callback error', { id, error: err })
      }
      // Re-arm only if not unregistered during callback. The map entry was set
      // before the previous setTimeout fired; if it's still there, we're free
      // to re-arm. unregister() during callback would have deleted the entry.
      if (!this.intervalHandles.has(id)) return
      const nextHandle = setTimeout(fire, ms)
      nextHandle.unref?.()
      this.intervalHandles.set(id, { handle: nextHandle, ms, callback })
    }

    const handle = setTimeout(fire, ms)
    handle.unref?.()
    this.intervalHandles.set(id, { handle, ms, callback })
  }

  private clearAll(): void {
    for (const [id, job] of this.cronJobs) {
      job.stop()
      logger.debug('Stopped cron on shutdown', { id })
    }
    this.cronJobs.clear()
    for (const [id, entry] of this.intervalHandles) {
      clearTimeout(entry.handle)
      logger.debug('Cleared interval/once on shutdown', { id })
    }
    this.intervalHandles.clear()
  }
}
