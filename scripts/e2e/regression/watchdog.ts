import type { AppRecord } from './lifecycle'
import { assertOwnedProcess, isAlive, terminateExactProcess, terminateOwnedMacProcessGroup } from './process'

const DEFAULT_INTERVAL_MS = 2_000
const DEFAULT_STALL_TIMEOUT_MS = 60_000
const PROBE_TIMEOUT_MS = 2_500
const PROBE_DEADLINE_MS = PROBE_TIMEOUT_MS * 3
const MAX_KILL_ATTEMPTS = 5
const DEFAULT_EXIT_CONFIRM_MS = 3_000

/** Fields the watchdog needs from the owned application record. */
export type WatchdogTarget = Pick<
  AppRecord,
  'platform' | 'runnerPid' | 'electronPid' | 'cdpPort' | 'mode' | 'targetRoot' | 'executablePath'
>

export interface WatchdogDeps {
  readTarget: () => WatchdogTarget
  probe: (target: WatchdogTarget) => Promise<void>
  kill: (target: WatchdogTarget) => void
  isAlive: (pid: number) => boolean
  now?: () => number
  intervalMs?: number
  stallTimeoutMs?: number
}

function withDeadline<T>(task: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`probe did not settle within ${timeoutMs}ms`)), timeoutMs)
    timer.unref()
  })
  return Promise.race([task, timeout]).finally(() => {
    if (timer) clearTimeout(timer)
  })
}

async function probeCdp(target: WatchdogTarget): Promise<void> {
  const response = await fetch(`http://127.0.0.1:${target.cdpPort}/json/version`, {
    signal: AbortSignal.timeout(PROBE_TIMEOUT_MS)
  })
  if (!response.ok) throw new Error(`CDP version endpoint returned HTTP ${response.status}`)
}

/**
 * The only kill path is the owned one: macOS signals the recorded process group after
 * re-checking that this run still owns it, and Windows re-checks both command lines
 * before taskkill. A reused PID therefore never takes an unrelated process down.
 */
function killFrozenApp(target: WatchdogTarget): void {
  if (target.platform === 'windows') {
    // Each pid is validated and terminated on its own: a first attempt that already took
    // one of them down must not block the other, and both failures are reported together.
    const failures: string[] = []
    for (const [pid, kind] of [
      [target.electronPid, 'electron'],
      [target.runnerPid, 'runner']
    ] as const) {
      if (!isAlive(pid)) continue
      try {
        assertOwnedProcess(target, pid, kind)
        terminateExactProcess(pid, 'windows')
      } catch (error) {
        failures.push(`${kind} ${pid}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    if (failures.length > 0) throw new Error(failures.join('; '))
    return
  }
  // A frozen main process cannot be identified by its own command line, so ownership is
  // established by the process group it was launched in.
  terminateOwnedMacProcessGroup(target, 'SIGKILL')
}

/**
 * Fails a stuck case instead of letting it eat the phase budget: a live application
 * whose CDP endpoint stops answering for `stallTimeoutMs` is killed, which also
 * rejects the pending Playwright call and lets teardown finish. A quit, restart or
 * relaunch replaces the recorded pids, which restarts the window instead of tripping.
 */
export class ApplicationWatchdog {
  private timer?: NodeJS.Timeout
  private stalledSince?: number
  private trippedReason?: string
  private killed = false
  private checking = false
  private generation = 0
  private lastIdentity?: string
  private killAttempts = 0
  private lastTripLog?: string
  private lastTrip: Promise<void> = Promise.resolve()
  private readonly exhaustedIdentities = new Set<string>()
  private readonly now: () => number
  private readonly intervalMs: number
  private readonly stallTimeoutMs: number
  private readonly exitConfirmMs: number

  constructor(
    private readonly deps: WatchdogDeps,
    options: { intervalMs?: number; stallTimeoutMs?: number; exitConfirmMs?: number } = {}
  ) {
    this.now = deps.now ?? Date.now
    this.intervalMs = options.intervalMs ?? deps.intervalMs ?? DEFAULT_INTERVAL_MS
    this.stallTimeoutMs = options.stallTimeoutMs ?? deps.stallTimeoutMs ?? DEFAULT_STALL_TIMEOUT_MS
    this.exitConfirmMs = options.exitConfirmMs ?? DEFAULT_EXIT_CONFIRM_MS
  }

  get reason(): string | undefined {
    return this.trippedReason
  }

  /** True only after the recorded process is confirmed gone. */
  get killedApplication(): boolean {
    return this.killed
  }

  /** Resolves once the kill attempt that is currently running has finished. */
  settled(): Promise<void> {
    return this.lastTrip
  }

  start(): void {
    if (this.timer || this.stallTimeoutMs <= 0) return
    this.timer = setInterval(() => void this.check(), this.intervalMs)
    this.timer.unref()
  }

  /** Also invalidates a probe that is already in flight, so it cannot kill after teardown. */
  stop(): void {
    this.generation += 1
    if (!this.timer) return
    clearInterval(this.timer)
    this.timer = undefined
  }

  async check(): Promise<void> {
    if (this.checking || this.killed || this.stallTimeoutMs <= 0) return
    const generation = this.generation
    this.checking = true
    try {
      const target = this.deps.readTarget()
      const identity = `${target.runnerPid}:${target.electronPid}`
      if (identity !== this.lastIdentity) {
        this.lastIdentity = identity
        this.stalledSince = undefined
        this.killAttempts = 0
      }
      const isLive = (candidate: WatchdogTarget) =>
        this.deps.isAlive(candidate.electronPid) || this.deps.isAlive(candidate.runnerPid)
      if (!isLive(target)) {
        this.stalledSince = undefined
        return
      }
      try {
        await withDeadline(this.deps.probe(target), PROBE_DEADLINE_MS)
      } catch (error) {
        if (generation !== this.generation) return
        // A restart or relaunch may have replaced the process while the probe was pending;
        // that failure belongs to the old process and must not cost the new one its window.
        const current = this.deps.readTarget()
        const currentIdentity = `${current.runnerPid}:${current.electronPid}`
        if (currentIdentity !== identity) {
          this.lastIdentity = currentIdentity
          this.stalledSince = undefined
          this.killAttempts = 0
          return
        }
        if (!isLive(current)) {
          this.stalledSince = undefined
          return
        }
        const now = this.now()
        this.stalledSince ??= now
        if (now - this.stalledSince < this.stallTimeoutMs) return
        // A process that survived its attempts is not retried, but the timer keeps
        // running so a replacement with new pids is still observed.
        if (this.exhaustedIdentities.has(currentIdentity)) return
        this.lastTrip = this.trip(current, error)
        await this.lastTrip
        return
      }
      if (generation !== this.generation) return
      this.stalledSince = undefined
      // A recovered identity gets a fresh kill budget; otherwise one bad patch would
      // disable kills for that pid pair for the rest of the run.
      this.exhaustedIdentities.delete(identity)
      this.killAttempts = 0
    } catch {
      // An unreadable record cannot be attributed to a process, so it never accrues stall time.
      this.stalledSince = undefined
    } finally {
      this.checking = false
    }
  }

  private async exited(target: WatchdogTarget): Promise<boolean> {
    const deadline = Date.now() + this.exitConfirmMs
    for (;;) {
      if (!this.deps.isAlive(target.electronPid) && !this.deps.isAlive(target.runnerPid)) return true
      if (Date.now() >= deadline) return false
      await new Promise((resolve) => setTimeout(resolve, 200))
    }
  }

  private async trip(target: WatchdogTarget, error: unknown): Promise<void> {
    const seconds = Math.round(this.stallTimeoutMs / 1000)
    const base = `Application unresponsive for ${seconds}s (${error instanceof Error ? error.message : String(error)})`
    // Set before the kill so teardown that starts meanwhile still reports the real cause.
    this.trippedReason = `${base}; killing the application`
    try {
      this.deps.kill(target)
      if (!(await this.exited(target))) {
        throw new Error(`the recorded process was still alive ${this.exitConfirmMs}ms after the kill signal`)
      }
      this.killed = true
      this.stop()
      this.trippedReason = `${base}; the test process killed it so teardown could finish`
    } catch (killError) {
      this.killAttempts += 1
      const why = killError instanceof Error ? killError.message : String(killError)
      this.trippedReason = `${base}; killing it failed (attempt ${this.killAttempts}): ${why}`
      if (this.killAttempts >= MAX_KILL_ATTEMPTS) {
        this.trippedReason += '; stopped retrying'
        this.exhaustedIdentities.add(`${target.runnerPid}:${target.electronPid}`)
      }
    }
    if (this.trippedReason !== this.lastTripLog) {
      this.lastTripLog = this.trippedReason
      process.stderr.write(`[regression-watchdog] ${this.trippedReason}\n`)
    }
  }
}

/**
 * A blank value means "not configured", not "disabled": a runner that forwards an unset
 * optional variable as '' must keep stall detection. Only an explicit numeric value —
 * 0 included — selects a timeout.
 */
export function resolveStallTimeoutMs(raw: string | undefined): number {
  const trimmed = raw?.trim()
  if (!trimmed) return DEFAULT_STALL_TIMEOUT_MS
  const configured = Number(trimmed)
  return Number.isFinite(configured) ? configured : DEFAULT_STALL_TIMEOUT_MS
}

function stallTimeoutFromEnv(): number {
  return resolveStallTimeoutMs(process.env.CHERRY_APP_STALL_TIMEOUT_MS)
}

export function createApplicationWatchdog(readTarget: () => WatchdogTarget): ApplicationWatchdog {
  return new ApplicationWatchdog({
    readTarget,
    probe: probeCdp,
    kill: killFrozenApp,
    isAlive,
    stallTimeoutMs: stallTimeoutFromEnv()
  })
}
