import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { MARKDOWN_RENDER_MIN_INTERVAL_MS, MARKDOWN_RENDER_STREAM_CADENCE_MS } from '../markdownRenderPacing'
import { MarkdownRenderScheduler, type RenderTicket } from '../markdownRenderScheduler'

class FakeHost {
  nowMs = 0
  renderRequests = 0
  paneClears = 0
  armedDelay: number | null = null
  clearedTimers = 0

  now() {
    return this.nowMs
  }
  armTimer(delayMs: number) {
    this.armedDelay = delayMs
  }
  clearTimer() {
    this.clearedTimers++
    this.armedDelay = null
  }
  requestRender() {
    this.renderRequests++
  }
  requestPaneClear() {
    this.paneClears++
  }
}

describe('MarkdownRenderScheduler', () => {
  let host: FakeHost
  let scheduler: MarkdownRenderScheduler

  const startRender = () => scheduler.renderStarted()
  const completeRender = (ticket: RenderTicket) => scheduler.renderCompleted(ticket)
  /** Drive a full render synchronously, returning the ticket it committed. */
  const runRenderNow = () => {
    const ticket = startRender()
    completeRender(ticket)
    return ticket
  }

  beforeEach(() => {
    host = new FakeHost()
    scheduler = new MarkdownRenderScheduler(host)
  })
  afterEach(() => {
    scheduler.dispose()
  })

  it('renders the first frame immediately, then paces stream frames via one armed timer', () => {
    const doc = 'x'.repeat(100)
    scheduler.onOutputChange(doc, true)
    expect(host.renderRequests).toBe(1)

    runRenderNow()
    host.nowMs += 16
    scheduler.onOutputChange(doc + 'a', true)
    expect(host.renderRequests).toBe(1)
    expect(host.armedDelay).toBe(MARKDOWN_RENDER_MIN_INTERVAL_MS - 16)

    // Further frames never re-arm the single timer slot.
    const firstDelay = host.armedDelay
    host.nowMs += 16
    scheduler.onOutputChange(doc + 'ab', true)
    expect(host.armedDelay).toBe(firstDelay)
  })

  it('fires the trailing timer and renders the final stream state', () => {
    const doc = 'y'.repeat(100)
    scheduler.onOutputChange(doc, true)
    runRenderNow()
    host.nowMs += 16
    scheduler.onOutputChange(doc + '!', true)
    expect(host.armedDelay).not.toBeNull()

    host.renderRequests = 0
    scheduler.onTimerFired()
    expect(host.renderRequests).toBe(1)
    const ticket = runRenderNow()
    expect(ticket.content).toBe(doc + '!')
  })

  it('renders a discrete swap immediately and supersedes an armed timer', () => {
    const doc = 'z'.repeat(100)
    scheduler.onOutputChange(doc, true)
    runRenderNow()
    host.nowMs += 16
    scheduler.onOutputChange(doc + ' more', true) // stream frame → armed
    expect(host.armedDelay).not.toBeNull()

    host.nowMs += MARKDOWN_RENDER_STREAM_CADENCE_MS + 50 // beyond cadence = discrete
    host.renderRequests = 0
    scheduler.onOutputChange('a completely different document', true)
    expect(host.renderRequests).toBe(1)
    expect(host.armedDelay).toBeNull()
    expect(host.clearedTimers).toBeGreaterThan(0)
  })

  it('renders dep-only changes (theme switch) immediately', () => {
    scheduler.onOutputChange('stable', true)
    runRenderNow()
    host.nowMs += 50
    host.renderRequests = 0
    scheduler.onOutputChange('stable', true) // same content, new shikiMarkdownIt identity
    expect(host.renderRequests).toBe(1)
  })

  it('renders a dep-only change immediately and supersedes an armed trailing timer', () => {
    const doc = 'w'.repeat(100)
    scheduler.onOutputChange(doc, true)
    runRenderNow()
    host.nowMs += 16
    scheduler.onOutputChange(doc + '+', true) // stream frame → armed
    expect(host.armedDelay).not.toBeNull()

    host.renderRequests = 0
    scheduler.onOutputChange(doc + '+', true) // dep-only (same content, new shiki fn)
    expect(host.renderRequests).toBe(1)
    expect(host.armedDelay).toBeNull()
    expect(host.clearedTimers).toBeGreaterThan(0)
  })

  it('catches up a discrete swap that landed mid-render instead of pacing it', () => {
    scheduler.onOutputChange('old doc', true)
    const t1 = startRender()

    host.nowMs += 500 // previous change far beyond cadence → discrete
    scheduler.onOutputChange('new doc', true)
    expect(host.renderRequests).toBe(1) // suppressed while in flight

    expect(completeRender(t1)).toBe('commit')
    expect(host.renderRequests).toBe(2) // immediate catch-up, not a timer
    expect(host.armedDelay).toBeNull()

    const t2 = startRender()
    expect(t2.content).toBe('new doc')
  })

  it('does not catch up paced-due stream frames that land mid-render', () => {
    // Dense cadence: frames must stay within 120ms of each other for a
    // timer-fired render to be mid-flight while the next frame is paced-due.
    scheduler.onOutputChange('a', true) // t=0: discrete first frame, immediate
    runRenderNow()
    host.nowMs = 100
    scheduler.onOutputChange('ab', true) // stream frame → arms timer
    expect(host.armedDelay).not.toBeNull()
    host.nowMs = 150
    scheduler.onOutputChange('abc', true) // still armed; cadence continues
    host.nowMs = 200
    scheduler.onOutputChange('abcd', true)

    host.nowMs = 250
    scheduler.onTimerFired() // render starts; slot freed
    const t1 = startRender()
    expect(host.renderRequests).toBe(2)

    host.nowMs = 264 // 64ms after the previous change (cadence), ≥ interval since last render
    scheduler.onOutputChange('abcde', true)
    expect(host.renderRequests).toBe(2) // paced-due: no pending, no extra render

    expect(completeRender(t1)).toBe('commit')
    expect(host.renderRequests).toBe(2) // follow-up is a paced timer, not immediate
    expect(host.armedDelay).not.toBeNull()
  })

  it('swallows a timer fire that lands mid-render instead of re-entering', () => {
    scheduler.onOutputChange('doc', true)
    startRender()
    host.renderRequests = 0
    scheduler.onTimerFired()
    expect(host.renderRequests).toBe(0) // inFlight guard swallows the fire
  })

  it('drops an in-flight render when the output is cleared', () => {
    scheduler.onOutputChange('stale content', true)
    const ticket = startRender()
    scheduler.onOutputChange('', true)
    expect(host.paneClears).toBe(1)

    expect(completeRender(ticket)).toBe('drop')
    expect(host.renderRequests).toBe(1) // no follow-up
    expect(host.armedDelay).toBeNull()
  })

  it('still renders static content that arrived while an older render was in flight across a clear (epoch handoff)', () => {
    scheduler.onOutputChange('old translation', true)
    const oldTicket = startRender()

    scheduler.onOutputChange('', true) // clear bumps the epoch
    scheduler.onOutputChange('restored history item', true) // discrete, arrives mid-flight
    expect(host.renderRequests).toBe(1) // queued as pending immediate

    expect(completeRender(oldTicket)).toBe('drop') // stale render must not commit
    expect(host.renderRequests).toBe(2) // but its completion serves the pending request

    const ticket = startRender()
    expect(ticket.content).toBe('restored history item')
    expect(completeRender(ticket)).toBe('commit')
  })

  it('renders immediately when markdown is re-enabled after output changed while disabled', () => {
    scheduler.onOutputChange('first', true)
    runRenderNow()

    scheduler.onOutputChange('changed while disabled', false)
    expect(host.paneClears).toBe(1)

    host.renderRequests = 0
    scheduler.onOutputChange('changed while disabled', true)
    expect(host.renderRequests).toBe(1) // immediate, never paced
    expect(host.armedDelay).toBeNull()
  })

  it('unsticks inFlight when a render resolves while disabled, and serves pending work after re-enable', () => {
    scheduler.onOutputChange('doc', true)
    startRender()
    scheduler.onOutputChange('doc', false) // disable mid-render
    scheduler.renderAborted()
    expect(host.renderRequests).toBe(1)

    host.renderRequests = 0
    scheduler.onOutputChange('doc', true) // re-enable with unchanged content
    expect(host.renderRequests).toBe(1) // scheduler must not be stuck in-flight
  })

  it('drops a queued pending immediate when the render aborts on disable', () => {
    scheduler.onOutputChange('doc', true)
    startRender()
    host.nowMs += 500
    scheduler.onOutputChange('swapped', true) // discrete mid-render → queued
    expect(host.renderRequests).toBe(1)

    scheduler.onOutputChange('swapped', false) // disable clears pending + timer
    scheduler.renderAborted()
    expect(host.paneClears).toBe(1)

    host.renderRequests = 0
    scheduler.onOutputChange('swapped', true) // re-enable → one immediate render
    expect(host.renderRequests).toBe(1)
    const ticket = startRender()
    expect(completeRender(ticket)).toBe('commit')
    expect(host.renderRequests).toBe(1) // no double catch-up from the stale queue
  })

  it('consumes a pending immediate exactly once (single catch-up render)', () => {
    const doc = 'q'.repeat(100)
    scheduler.onOutputChange(doc, true) // t=0 immediate
    runRenderNow()
    host.nowMs = 100
    scheduler.onOutputChange(doc + 'a', true) // stream frame → arms timer
    host.nowMs = 250
    scheduler.onTimerFired()
    const t1 = startRender()
    expect(host.renderRequests).toBe(2)

    host.nowMs = 380 // 280ms after the last change → discrete, delay===0
    scheduler.onOutputChange('swapped document', true)
    expect(host.renderRequests).toBe(2) // queued as pending while in flight

    expect(completeRender(t1)).toBe('commit')
    expect(host.renderRequests).toBe(3) // exactly one catch-up

    const t2 = startRender()
    expect(t2.content).toBe('swapped document')
    expect(completeRender(t2)).toBe('commit')
    expect(host.renderRequests).toBe(3) // no further catch-up
  })

  it('arms a paced follow-up on completion only when content moved and no timer is armed', () => {
    scheduler.onOutputChange('base', true)
    const t1 = startRender()
    host.nowMs += 10
    scheduler.onOutputChange('base+', true)
    expect(completeRender(t1)).toBe('commit')
    expect(host.armedDelay).not.toBeNull()

    // Quiet completion with unchanged content arms nothing.
    const t2 = startRender()
    expect(completeRender(t2)).toBe('commit')
    // Still the single armed timer from before; no re-arm churn.
    expect(host.clearedTimers).toBe(0)
  })
})
