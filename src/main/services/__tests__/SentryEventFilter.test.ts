import type { ErrorEvent } from '@sentry/electron/main'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SentryEventFilter } from '../SentryEventFilter'

function unexpected(message: string, type = 'Error'): ErrorEvent {
  return { exception: { values: [{ type, value: message, mechanism: { type: 'generic', handled: false } }] } }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-27T00:00:00Z'))
})

afterEach(() => vi.useRealTimers())

describe('application failure selection', () => {
  it('admits explicitly reported handled internal failures while still filtering operational noise', () => {
    const filter = new SentryEventFilter()
    const handled = (message: string): ErrorEvent => ({
      exception: { values: [{ type: 'Error', value: message, mechanism: { type: 'generic', handled: true } }] },
      tags: { 'failure.kind': 'unexpected' }
    })
    expect(filter.allow(handled('fetch failed'))).toBe(false)
    expect(filter.allow(handled('Broken internal state'))).toBe(true)
    expect(filter.allow(handled('Broken internal state'))).toBe(false)
  })

  it('requires an unhandled exception or an explicit application failure', () => {
    const filter = new SentryEventFilter()
    expect(filter.allow({ message: 'Business request failed', level: 'error' })).toBe(false)
    expect(filter.allow({ exception: { values: [{ type: 'Error', value: 'Business request failed' }] } })).toBe(false)
    expect(filter.allow(unexpected('Broken internal state'))).toBe(true)
    expect(filter.allow(unexpected('Session not found', 'DataApiError'))).toBe(true)
  })

  it.each([
    ['Cancelled', 'AbortError'],
    ['Cancelled', 'CanceledError'],
    ['The operation timed out', 'TimeoutError'],
    ['net::ERR_CONNECTION_RESET', 'Error'],
    ['net::ERR_CONNECTION_CLOSED', 'Error'],
    ['net::ERR_ABORTED', 'Error'],
    ['net::ERR_NETWORK_CHANGED', 'Error'],
    ['read ECONNRESET', 'Error'],
    ['connect ECONNREFUSED 127.0.0.1:1234', 'Error'],
    ['Failed to fetch', 'TypeError'],
    ['fetch failed', 'TypeError']
  ])('drops automatic operational noise: %s', (message, type) => {
    expect(new SentryEventFilter().allow(unexpected(message, type))).toBe(false)
  })

  it('does not treat a diagnostic mention of a network code as a network failure', () => {
    expect(new SentryEventFilter().allow(unexpected('Unexpected state after ECONNRESET'))).toBe(true)
  })

  it.each(['startup', 'render'])('preserves explicit %s failures even with a transient cause', (kind) => {
    expect(
      new SentryEventFilter().allow({
        ...unexpected('fetch failed'),
        tags: { 'failure.kind': kind }
      })
    ).toBe(true)
  })

  it('preserves fatal automatic exceptions and native process crash messages', () => {
    const filter = new SentryEventFilter()
    expect(filter.allow({ ...unexpected('net::ERR_CONNECTION_RESET'), level: 'fatal' })).toBe(true)
    expect(filter.allow({ message: "'renderer' process exited with 'crashed'", level: 'fatal' })).toBe(true)
  })
})

describe('application event volume', () => {
  it('charges handled internal failures to the unexpected budget, preserving the critical reserve', () => {
    const filter = new SentryEventFilter()
    for (let index = 0; index < 10; index++) {
      expect(filter.allow({ message: `Internal fault ${index}`, tags: { 'failure.kind': 'unexpected' } })).toBe(true)
    }
    expect(filter.allow(unexpected('Unhandled fault'))).toBe(false)
    expect(filter.allow({ message: 'Main window failed', tags: { 'failure.kind': 'startup' } })).toBe(true)
    expect(filter.allow({ message: 'Preview failed', tags: { 'failure.kind': 'render' } })).toBe(true)
  })

  it('deduplicates interleaved events across windows and reopens after ten minutes', () => {
    const filter = new SentryEventFilter()
    const event = unexpected('Unexpected render state')
    expect(filter.allow({ ...event, tags: { window: 'mainWindow' } })).toBe(true)
    expect(filter.allow(unexpected('Another fault'))).toBe(true)
    expect(filter.allow({ ...event, tags: { window: 'QuickAssistant' } })).toBe(false)
    vi.advanceTimersByTime(10 * 60 * 1000)
    expect(filter.allow(event)).toBe(true)
  })

  it('ignores dynamic UUIDs without collapsing distinct call sites', () => {
    const filter = new SentryEventFilter()
    expect(filter.allow(unexpected("Session 'c22376d8-586f-4088-8a3a-466d069ad35f' not found"))).toBe(true)
    expect(filter.allow(unexpected("Session '5e8f1519-2440-4883-9f8d-9f0a3f513387' not found"))).toBe(false)
    const event = unexpected("Session '5e8f1519-2440-4883-9f8d-9f0a3f513387' not found")
    event.exception!.values![0].stacktrace = { frames: [{ filename: 'app:///session.js', lineno: 20 }] }
    expect(filter.allow(event)).toBe(true)
  })

  it('reserves independent hourly budgets and does not charge filtered or duplicate events', () => {
    const filter = new SentryEventFilter()
    for (let index = 0; index < 30; index++) expect(filter.allow(unexpected('fetch failed'))).toBe(false)
    const first = unexpected('Fault 0')
    expect(filter.allow(first)).toBe(true)
    for (let index = 0; index < 30; index++) expect(filter.allow(first)).toBe(false)
    for (let index = 1; index < 10; index++) expect(filter.allow(unexpected(`Fault ${index}`))).toBe(true)
    expect(filter.allow(unexpected('Beyond budget'))).toBe(false)
    for (let index = 0; index < 10; index++) {
      expect(filter.allow({ message: `Crash ${index}`, level: 'fatal' })).toBe(true)
    }
    expect(filter.allow({ message: 'Another crash', level: 'fatal' })).toBe(false)
    vi.advanceTimersByTime(60 * 60 * 1000)
    expect(filter.allow(unexpected('Beyond budget'))).toBe(true)
    expect(filter.allow({ message: 'Another crash', level: 'fatal' })).toBe(true)
  })
})
