import { useCallback, useEffect, useRef, useState } from 'react'

interface UseSmoothStreamOptions {
  onUpdate: (text: string) => void
  /** Optional external control. Omit to let the hook manage it via `update(_, isComplete)`. */
  streamDone?: boolean
  minDelay?: number
  initialText?: string
}

const languages = ['en-US', 'de-DE', 'es-ES', 'zh-CN', 'zh-TW', 'ja-JP', 'ru-RU', 'el-GR', 'fr-FR', 'pt-PT', 'ro-RO']
const segmenter = new Intl.Segmenter(languages)

/**
 * Playout is an adaptive jitter buffer: bursty, IPC-coalesced input is queued
 * and released at the *recent sustained inbound rate*, so output velocity
 * tracks the model — fast model fast, slow model slow, never faster (which
 * would drain the buffer and re-introduce the wait) and never the old
 * fixed-fraction crawl.
 *
 * The rate estimate is sustained = total graphemes since the first chunk /
 * max(elapsed, SUSTAINED_MIN_MS). The denominator floor caps the cold-start
 * spike (a burst can't divide by ~0). Crucially `elapsed` is monotonic and
 * `total > 0`, so the rate never collapses to 0 during a stall — that is
 * what lets the cushion actually span a multi-second stall. (A trailing
 * window — the earlier design — died once it emptied, so `target = rate ·
 * sec` went to 0 and the restoring term drained the whole cushion in
 * ~RELAX regardless of CAP.)
 *
 * Rate-matching alone has no restoring force: output ≈ average input keeps
 * the buffer wherever it happened to settle, so a bursty-but-fast stream
 * (dense token, then an inter-chunk gap) can drain to empty during the gap
 * and stutter. So playout also targets a small cushion sized to the jitter,
 * `target = rate * TARGET_DELAY_SEC`, via a proportional restoring term:
 * below target ⇒ play slower than `rate` to let the next burst refill it;
 * above ⇒ slightly faster. Steady-state queue converges to `target`, i.e. a
 * fixed ≈`TARGET_DELAY_SEC` display latency bought to keep gaps from
 * underrunning — the fundamental jitter-buffer trade (buffer depth ⇄ delay).
 *
 *  - `MIN_STEP` is only a progress guarantee (anti-rounding-stall), NOT a
 *    speed floor — a high floor would over-drain a genuinely slow stream.
 *  - `MAX_BACKLOG` is a hard latency ceiling vs the live model.
 *  - First frame emits only `MIN_STEP` (no real `dt` / rate yet) so a burst
 *    that accumulated before mount isn't dumped in one frame.
 *
 * Characters are never dropped; "overflow" accelerates output instead. True
 * upstream silence with an empty queue still waits — no algorithm can show
 * tokens that have not arrived.
 */
/** Denominator floor for the sustained-rate estimate — bounds the cold-start
 *  spike (first burst ÷ ~0). */
const SUSTAINED_MIN_MS = 1000
/**
 * Cushion depth (≈ display latency, seconds) is adaptive per stream: a
 * decaying peak of observed stall lengths, clamped to [FLOOR, CAP].
 *  - FLOOR: minimum cushion for any provider — a frame-quantization/jitter
 *    floor below the perception threshold; smooth providers stay here.
 *  - CAP: a UX *policy* budget — the max steady latency we trade for
 *    smoothness (NOT a universal constant; tune per product surface).
 *  - A gap counts as a "stall" (and arms the cushion) only when it exceeds
 *    `max(ARM_ABS_MIN, ARM_FACTOR × recent median gap)` — relative to the
 *    stream's *own* cadence, so a genuinely slow-but-steady provider isn't
 *    misread as stalling.
 *  - Fast attack (one stall arms it immediately), slow release (decays over
 *    RELEASE so the cushion is still up for the next recurring stall).
 */
const TARGET_DELAY_FLOOR_SEC = 0.08
const TARGET_DELAY_CAP_SEC = 0.8
const STALL_ARM_ABS_MIN_SEC = 0.25
const STALL_ARM_FACTOR = 6
const STALL_RELEASE_SEC = 6
const GAP_SAMPLES = 32
/** Time constant of the proportional pull of the queue toward `target`.
 *  ≫ frame `dt` so the controller is well-damped (no oscillation). */
const RELAX_SEC = 0.3
const MAX_BACKLOG = 400
/** rAF doesn't fire in background tabs; on return `dt` would be huge and
 *  drain the whole queue. Clamp so a hidden→visible tab resumes smoothly. */
const MAX_FRAME_DT_MS = 100

/**
 * After the upstream stream ends there are no more arrivals, so `rate_est`
 * decays to ~0. The tail then plays out at `max(POST_STREAM_STEP per frame,
 * fast enough to finish within POST_STREAM_DRAIN_SEC)`: a short tail keeps
 * the gentle typewriter; a multi-thousand-char tail finishes in a couple of
 * seconds instead of crawling at MIN_STEP.
 */
const POST_STREAM_STEP = 5
const POST_STREAM_DRAIN_SEC = 2.0

const MIN_STEP = 1

export const useSmoothStream = ({
  onUpdate,
  streamDone: externalStreamDone,
  minDelay = 10,
  initialText = ''
}: UseSmoothStreamOptions) => {
  const chunkQueueRef = useRef<string[]>([])
  const animationFrameRef = useRef<number | null>(null)
  const displayedTextRef = useRef<string>(initialText)
  const lastFrameTimeRef = useRef<number>(0)
  const lastAccumulatedRef = useRef<string>(initialText)
  /** Sustained-rate accumulators: graphemes since the first chunk and the
   *  first chunk's timestamp (-1 = none yet). Held across stalls so the
   *  cushion math doesn't collapse when input pauses. */
  const totalCharsRef = useRef<number>(0)
  const firstChunkTRef = useRef<number>(-1)
  /** Decaying peak of observed stall lengths (seconds) → adaptive cushion. */
  const stallEstRef = useRef<number>(0)
  /** Ring of recent inter-arrival gaps (ms) for the relative ARM threshold. */
  const gapsRef = useRef<number[]>([])
  /** Last arrival timestamp — survives `arrivalsRef` pruning so a >window
   *  stall's gap is still measurable. Seeded to stream-start while idling so
   *  the first arrival's gap is the startup/TTFT latency. */
  const lastArrivalTRef = useRef<number>(0)
  /** False until the first chunk: the startup/TTFT gap arms the cushion but
   *  must NOT enter the cadence-median samples (it would poison the relative
   *  ARM threshold for every later stall). */
  const sawFirstChunkRef = useRef<boolean>(false)
  /** Sub-1-grapheme-per-frame playout budget carried between frames so slow
   *  streams aren't forced up to MIN_STEP/frame. */
  const creditRef = useRef<number>(0)
  const [internalStreamDone, setInternalStreamDone] = useState<boolean>(false)
  const streamDone = externalStreamDone ?? internalStreamDone

  const onUpdateRef = useRef(onUpdate)
  useEffect(() => {
    onUpdateRef.current = onUpdate
  })

  const addChunk = useCallback((chunk: string) => {
    const chars = Array.from(segmenter.segment(chunk)).map((s) => s.segment)
    if (chars.length === 0) return
    const now = performance.now()
    chunkQueueRef.current = [...chunkQueueRef.current, ...chars]
    if (firstChunkTRef.current < 0) firstChunkTRef.current = now
    totalCharsRef.current += chars.length

    // Stall detection: a gap is a "stall" only if it dwarfs this stream's
    // own recent cadence (relative ARM) — protects slow-but-steady providers.
    const prev = lastArrivalTRef.current
    lastArrivalTRef.current = now
    if (prev > 0) {
      const gap = now - prev
      const gaps = gapsRef.current
      // Startup/TTFT gap arms the cushion but is excluded from the cadence
      // median (median over GAP_SAMPLES is already robust to the ~few-percent
      // recurring stalls, but a single huge TTFT in a near-empty ring would
      // poison it). All later gaps feed the median.
      if (sawFirstChunkRef.current) {
        gaps.push(gap)
        if (gaps.length > GAP_SAMPLES) gaps.shift()
      }
      const sorted = [...gaps].sort((a, b) => a - b)
      const medGap = sorted[sorted.length >> 1] ?? 0
      const armMs = Math.max(STALL_ARM_ABS_MIN_SEC * 1000, STALL_ARM_FACTOR * medGap)
      if (gap > armMs) {
        // Fast attack: one stall arms the cushion (clamped to CAP).
        stallEstRef.current = Math.max(stallEstRef.current, Math.min(gap / 1000, TARGET_DELAY_CAP_SEC))
      }
      sawFirstChunkRef.current = true
    }
    ensureLoopRef.current()
  }, [])

  const reset = useCallback(
    (newText = '') => {
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current)
        animationFrameRef.current = null
      }
      chunkQueueRef.current = []
      totalCharsRef.current = 0
      firstChunkTRef.current = -1
      stallEstRef.current = 0
      gapsRef.current = []
      lastArrivalTRef.current = 0
      sawFirstChunkRef.current = false
      creditRef.current = 0
      lastFrameTimeRef.current = 0
      displayedTextRef.current = newText
      lastAccumulatedRef.current = newText
      if (externalStreamDone === undefined) setInternalStreamDone(false)
      onUpdateRef.current(newText)
      // Revive the loop: it was just cancelled, and a same-value
      // setInternalStreamDone wouldn't change renderLoop identity.
      ensureLoopRef.current()
    },
    [externalStreamDone]
  )

  /**
   * Accumulated-text-style entry point. Matches the `(text, isComplete)`
   * shape that `translateText` / `useTranslate` emit. Computes the delta
   * against the last call and flips `streamDone` on `isComplete=true`.
   * Only available when no external `streamDone` prop is passed.
   */
  const update = useCallback(
    (accumulated: string, isComplete: boolean) => {
      if (accumulated.startsWith(lastAccumulatedRef.current)) {
        const delta = accumulated.slice(lastAccumulatedRef.current.length)
        lastAccumulatedRef.current = accumulated
        if (delta) addChunk(delta)
      } else {
        // Non-monotonic update (e.g. the caller trims on completion): the
        // prefix-extension assumption broke. Re-base so the final displayed
        // text equals `accumulated` exactly (UI ⇄ resolved/saved parity).
        lastAccumulatedRef.current = accumulated
        const shown = displayedTextRef.current
        if (accumulated.startsWith(shown)) {
          chunkQueueRef.current = Array.from(segmenter.segment(accumulated.slice(shown.length))).map((s) => s.segment)
        } else {
          chunkQueueRef.current = []
          displayedTextRef.current = accumulated
          onUpdateRef.current(accumulated)
        }
        ensureLoopRef.current()
      }
      if (isComplete && externalStreamDone === undefined) setInternalStreamDone(true)
    },
    [addChunk, externalStreamDone]
  )

  const renderLoop = useCallback(() => {
    const queue = chunkQueueRef.current

    // Empty queue: finalize + stop if the stream ended, else idle one frame.
    if (queue.length === 0) {
      if (streamDone) {
        onUpdateRef.current(displayedTextRef.current)
        animationFrameRef.current = null
        return
      }
      // Stamp stream-start while idling pre-first-token, so the first
      // arrival's gap = startup/TTFT latency and arms the cushion like the
      // (largest) stall it effectively is — covering even the first
      // mid-stream stall. Fast-start providers (TTFT < ARM) stay at FLOOR.
      if (lastArrivalTRef.current === 0) lastArrivalTRef.current = performance.now()
      animationFrameRef.current = requestAnimationFrame(renderLoop)
      return
    }

    const now = performance.now()
    const last = lastFrameTimeRef.current

    // First frame after mount/reset: no reference dt and no rate sample yet.
    // Establish the clock and reveal only MIN_STEP so a burst that piled up
    // before the loop started is not dumped in one frame.
    if (last === 0) {
      lastFrameTimeRef.current = now
      const n = Math.min(MIN_STEP, queue.length)
      displayedTextRef.current += queue.slice(0, n).join('')
      chunkQueueRef.current = queue.slice(n)
      onUpdateRef.current(displayedTextRef.current)
      if (chunkQueueRef.current.length > 0 || !streamDone) {
        animationFrameRef.current = requestAnimationFrame(renderLoop)
      } else {
        animationFrameRef.current = null
      }
      return
    }

    // Throttle on the *unclamped* elapsed so minDelay > MAX_FRAME_DT_MS still
    // works; clamp only the dt that drives the playout math (so a
    // backgrounded-then-resumed tab doesn't dump the queue).
    const elapsed = now - last
    if (elapsed < minDelay) {
      animationFrameRef.current = requestAnimationFrame(renderLoop)
      return
    }
    lastFrameTimeRef.current = now
    const dt = Math.min(elapsed, MAX_FRAME_DT_MS)

    let count: number
    if (streamDone) {
      // No more arrivals: gentle typewriter for short tails, but fast enough
      // that a huge tail still finishes within POST_STREAM_DRAIN_SEC.
      const perFrameToFinish = Math.ceil((queue.length * dt) / (POST_STREAM_DRAIN_SEC * 1000))
      count = Math.max(POST_STREAM_STEP, perFrameToFinish)
    } else {
      // Sustained rate: total / max(elapsed, floor). Never 0 mid-stall
      // (total>0, elapsed monotonic), so the cushion below truly spans it.
      const elapsedMs = now - firstChunkTRef.current
      const ratePerSec = (totalCharsRef.current / Math.max(elapsedMs, SUSTAINED_MIN_MS)) * 1000

      // Slow release: the armed cushion decays toward 0 (→ FLOOR) so a
      // stream that stops stalling returns to low latency.
      stallEstRef.current *= Math.exp(-(dt / 1000) / STALL_RELEASE_SEC)
      const targetSec = Math.min(TARGET_DELAY_CAP_SEC, Math.max(TARGET_DELAY_FLOOR_SEC, stallEstRef.current))

      // Play at the inbound rate, pulled toward the adaptive cushion:
      // below target → slower (let the next burst refill), above → faster.
      const target = ratePerSec * targetSec
      const adjustedRate = ratePerSec + (queue.length - target) / RELAX_SEC

      if (adjustedRate > 0) {
        // Fractional credit: a sub-1-grapheme-per-frame budget accumulates,
        // so a genuinely slow stream plays at its true rate instead of the
        // old MIN_STEP (≈60/s at 60fps) floor that dumped slow input then
        // stalled. MIN_STEP is no longer a speed floor.
        creditRef.current += (adjustedRate * dt) / 1000
        count = Math.floor(creditRef.current)
        creditRef.current -= count
      } else {
        // adjustedRate ≤ 0 only when the queue is deep below the cushion —
        // a stall draining past equilibrium. Dribble MIN_STEP so the buffer
        // keeps flowing instead of freezing with content unshown.
        // Slow-steady streams keep adjustedRate > 0 and never reach here.
        count = MIN_STEP
        creditRef.current = 0
      }
      if (queue.length - count > MAX_BACKLOG) {
        // Hard latency ceiling vs the live model.
        count = queue.length - MAX_BACKLOG
      }
    }

    count = Math.min(count, queue.length)

    displayedTextRef.current += queue.slice(0, count).join('')
    chunkQueueRef.current = queue.slice(count)

    onUpdateRef.current(displayedTextRef.current)

    if (chunkQueueRef.current.length > 0 || !streamDone) {
      animationFrameRef.current = requestAnimationFrame(renderLoop)
    } else {
      animationFrameRef.current = null
    }
  }, [streamDone, minDelay])

  // The loop stops itself (animationFrameRef → null) when there is nothing
  // to do. `ensureLoop` revives it; `addChunk`/`reset` call it so a queued
  // chunk or a post-reset restart is never stranded waiting for a
  // `renderLoop`-identity change (the old bug: reset cancelled the frame,
  // and when `streamDone` didn't change value nothing rescheduled it).
  const ensureLoop = useCallback(() => {
    if (animationFrameRef.current === null) {
      animationFrameRef.current = requestAnimationFrame(renderLoop)
    }
  }, [renderLoop])
  const ensureLoopRef = useRef(ensureLoop)
  useEffect(() => {
    ensureLoopRef.current = ensureLoop
  })

  useEffect(() => {
    ensureLoop()
    return () => {
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current)
        animationFrameRef.current = null
      }
    }
  }, [ensureLoop])

  return { addChunk, reset, update }
}
