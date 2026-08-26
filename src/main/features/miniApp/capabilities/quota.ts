/**
 * Three independent exhaustion axes. Capping one is capping neither of the others:
 * a million empty keys trips no byte budget, and one giant value trips no count.
 * Write rate is the third — a `save()` inside requestAnimationFrame overwrites the
 * same entry forever, so it never trips capacity while still grinding the disk.
 */

import type { QuotaUsage } from '@shared/types/miniAppQuota'

export const MINI_APP_QUOTAS = {
  // 1 MB is the WHOLE save file (design §6.2), so `single` can never exceed it.
  storage: { bytes: 1024 * 1024, count: 1000, single: 1024 * 1024 },
  file: { bytes: 20 * 1024 * 1024, count: 200, single: 10 * 1024 * 1024 }
} as const

export type QuotaKind = keyof typeof MINI_APP_QUOTAS

/** Named to match the web's localStorage error so developers need learn nothing new. */
export class QuotaExceededError extends Error {
  constructor(readonly detail: string) {
    super(`QuotaExceededError: ${detail}`)
    this.name = 'QuotaExceededError'
  }
}

/**
 * A rate limit, not a capacity limit — the app must WAIT, not free something up.
 *
 * Subclasses `QuotaExceededError` on purpose: both mean "not now, you have used too
 * much", every existing `toThrow(QuotaExceededError)` assertion keeps holding, and the
 * bridge can still map it to its own public `RateLimited` name by checking this class
 * first. A sibling class would have split those assertions for no gain.
 */
export class RateLimitedError extends QuotaExceededError {
  constructor(detail: string) {
    super(detail)
    this.name = 'RateLimitedError'
  }
}

/**
 * The base64 string length that decodes to at most `bytes` (plus at most two bytes
 * of the final quantum).
 *
 * Exists so payload schemas can reject BEFORE decoding: 4 base64 characters carry 3
 * bytes, and `4 * ceil(bytes / 3)` is exactly the padded length of a `bytes`-sized
 * payload. A cheap pre-filter whose job is to stop the allocation, not to be the exact
 * quota. `assertWithinQuota` remains the authority on the real number.
 */
export function base64CharCap(bytes: number): number {
  return Math.ceil(bytes / 3) * 4
}

export function assertWithinQuota(kind: QuotaKind, usage: QuotaUsage, delta: QuotaUsage): void {
  const limits = MINI_APP_QUOTAS[kind]
  if (delta.bytes > limits.single) {
    throw new QuotaExceededError(`${kind} entry of ${delta.bytes} bytes exceeds the ${limits.single} byte cap`)
  }
  if (usage.bytes + delta.bytes > limits.bytes) {
    throw new QuotaExceededError(`${kind} would exceed its ${limits.bytes} byte budget`)
  }
  if (usage.count + delta.count > limits.count) {
    throw new QuotaExceededError(`${kind} would exceed its ${limits.count} entry budget`)
  }
}

const WINDOW_MS = 1000

/**
 * Two windows, not one. A call-count cap alone does not bound disk: 20 writes/second at
 * the 10 MB single-file cap is 200 MB/s, and an overwrite hands the logical quota right
 * back, so the capacity layer never fires. The byte window is the line that actually
 * limits the drive.
 *
 * Calls use a fixed window; BYTES use a token bucket.
 *
 * A fixed byte window smaller than the single-file cap makes legitimate writes
 * permanently impossible — an 8 MB/s window means a 9 MB file can never be saved at any
 * moment, which is not rate limiting, it is deleting a declared feature. The bucket's
 * CAPACITY covers one full-size write; its REFILL is the sustained rate.
 */
export class WriteRateLimiter {
  private readonly windows = new Map<string, { start: number; used: number }>()
  private readonly buckets = new Map<string, { tokens: number; at: number }>()

  constructor(
    private readonly perSecond = 20,
    private readonly burstBytes = 12 * 1024 * 1024,
    private readonly refillBytesPerSecond = 8 * 1024 * 1024
  ) {}

  /** `bytes` is the DECODED size this call writes; a pure delete passes 0 and still counts. */
  check(appId: string, bytes = 0): void {
    const now = Date.now()
    const win = this.windows.get(appId)
    if (!win || now - win.start >= WINDOW_MS) {
      this.windows.set(appId, { start: now, used: 1 })
    } else if (win.used >= this.perSecond) {
      throw new RateLimitedError(`write rate exceeded: more than ${this.perSecond} writes per second`)
    } else {
      win.used += 1
    }

    const bucket = this.buckets.get(appId) ?? { tokens: this.burstBytes, at: now }
    const refilled = Math.min(this.burstBytes, bucket.tokens + ((now - bucket.at) / 1000) * this.refillBytesPerSecond)
    if (refilled < bytes) {
      this.buckets.set(appId, { tokens: refilled, at: now })
      throw new RateLimitedError(`write volume exceeded: more than ${this.refillBytesPerSecond} bytes per second`)
    }
    this.buckets.set(appId, { tokens: refilled - bytes, at: now })
  }
}

/** Runs at most once — a second call is a no-op, never somebody else's slot. */
export type ReleaseSlot = () => void

/**
 * Rate AND concurrency, because either alone is not a bound: 60 calls a minute still
 * permits all 60 in flight at once, and 4 slots still permit thousands a minute if each
 * returns fast. `check()` cannot express the second — a slot has to be GIVEN BACK — so
 * this hands out a release the caller runs in `finally`.
 */
export class ConcurrentRateLimiter {
  private readonly windows = new Map<string, { start: number; calls: number }>()
  private readonly inflight = new Map<string, number>()

  constructor(
    private readonly label: string,
    private readonly perMinute: number,
    private readonly maxInFlight: number
  ) {}

  acquire(appId: string): ReleaseSlot {
    const now = Date.now()
    const win = this.windows.get(appId)
    if (!win || now - win.start >= 60_000) {
      this.windows.set(appId, { start: now, calls: 1 })
    } else if (win.calls >= this.perMinute) {
      throw new RateLimitedError(`${this.label} burst cutoff: more than ${this.perMinute} calls per minute`)
    } else {
      win.calls += 1
    }

    const live = this.inflight.get(appId) ?? 0
    if (live >= this.maxInFlight) {
      throw new RateLimitedError(`${this.label} concurrency cutoff: more than ${this.maxInFlight} in flight`)
    }
    this.inflight.set(appId, live + 1)

    // Idempotent: a caller that releases twice must not free somebody else's slot, and a
    // leaked slot is permanent — it is never reclaimed by a timer or a sweep.
    let released = false
    return () => {
      if (released) return
      released = true
      this.inflight.set(appId, Math.max(0, (this.inflight.get(appId) ?? 1) - 1))
    }
  }
}

/** Design §9 freezes both numbers: 60 calls per minute, 4 in flight, per app. */
export const networkLimiter = new ConcurrentRateLimiter('network.fetch', 60, 4)
