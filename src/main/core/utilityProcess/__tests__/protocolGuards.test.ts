import { describe, expect, it } from 'vitest'

import { PROTOCOL, PROTOCOL_VERSION } from '../protocol/constants'
import type { FrameIdentity } from '../protocol/frames'
import { isChildFrame, isConnectFrame, isMainFrame, isRemoteError, matchesIdentity } from '../protocol/guards'

const identity: FrameIdentity = { protocol: PROTOCOL, version: PROTOCOL_VERSION, processId: 'test.echo', generation: 1 }
const stamp = (frame: Record<string, unknown>) => ({ ...identity, ...frame })

describe('frame guards', () => {
  it('accepts every canonical frame kind on both directions', () => {
    expect(isConnectFrame(stamp({ kind: 'connect', initData: undefined }))).toBe(true)
    expect(isMainFrame(stamp({ kind: 'request', requestId: 1, method: 'ping', input: undefined }))).toBe(true)
    expect(isMainFrame(stamp({ kind: 'cancel', requestId: 1 }))).toBe(true)
    expect(isMainFrame(stamp({ kind: 'shutdown' }))).toBe(true)
    expect(isChildFrame(stamp({ kind: 'ready' }))).toBe(true)
    expect(isChildFrame(stamp({ kind: 'event', requestId: 2, event: { pct: 5 } }))).toBe(true)
    expect(isChildFrame(stamp({ kind: 'result', requestId: 2, output: null }))).toBe(true)
    expect(isChildFrame(stamp({ kind: 'error', requestId: 2, error: { name: 'Error', message: 'x' } }))).toBe(true)
    expect(isChildFrame(stamp({ kind: 'startup-error', error: { name: 'Error', message: 'x', code: 7 } }))).toBe(true)
    expect(isChildFrame(stamp({ kind: 'log', level: 'info', message: 'hi' }))).toBe(true)
    expect(isChildFrame(stamp({ kind: 'log', level: 'warn', message: 'hi', requestId: 3, fields: { a: 1 } }))).toBe(
      true
    )
    expect(isChildFrame(stamp({ kind: 'protocol-error', message: 'bad' }))).toBe(true)
  })

  it('rejects frames from another protocol or version', () => {
    expect(isChildFrame({ ...stamp({ kind: 'ready' }), protocol: 'other' })).toBe(false)
    expect(isMainFrame({ ...stamp({ kind: 'shutdown' }), version: PROTOCOL_VERSION + 1 })).toBe(false)
    expect(isChildFrame(null)).toBe(false)
    expect(isChildFrame('ready')).toBe(false)
  })

  it('rejects request ids that are not positive integers', () => {
    expect(isMainFrame(stamp({ kind: 'request', requestId: 0, method: 'ping', input: 1 }))).toBe(false)
    expect(isMainFrame(stamp({ kind: 'request', requestId: 1.5, method: 'ping', input: 1 }))).toBe(false)
    expect(isMainFrame(stamp({ kind: 'cancel', requestId: '1' }))).toBe(false)
    expect(isChildFrame(stamp({ kind: 'log', level: 'info', message: 'hi', requestId: -1 }))).toBe(false)
  })

  it('rejects requests without an input slot or with an empty method', () => {
    expect(isMainFrame(stamp({ kind: 'request', requestId: 1, method: 'ping' }))).toBe(false)
    expect(isMainFrame(stamp({ kind: 'request', requestId: 1, method: '', input: 1 }))).toBe(false)
  })

  it('rejects malformed log and error payloads', () => {
    expect(isChildFrame(stamp({ kind: 'log', level: 'verbose', message: 'hi' }))).toBe(false)
    expect(isChildFrame(stamp({ kind: 'log', level: 'info', message: 42 }))).toBe(false)
    expect(isChildFrame(stamp({ kind: 'log', level: 'info', message: 'hi', fields: 'nope' }))).toBe(false)
    expect(isChildFrame(stamp({ kind: 'error', requestId: 1, error: { name: 'Error', message: 42 } }))).toBe(false)
    expect(isChildFrame(stamp({ kind: 'error', requestId: 1, error: { name: 'Error', message: 'x', code: {} } }))).toBe(
      false
    )
    expect(isRemoteError({ name: 'E', message: 'm', stack: 1 })).toBe(false)
    expect(isChildFrame(stamp({ kind: 'result', requestId: 1 }))).toBe(false)
    expect(isChildFrame(stamp({ kind: 'bogus' }))).toBe(false)
  })

  it('detects a frame from another process id or generation', () => {
    expect(matchesIdentity(stamp({ kind: 'ready' }), identity)).toBe(true)
    expect(matchesIdentity({ ...identity, generation: 2 }, identity)).toBe(false)
    expect(matchesIdentity({ ...identity, processId: 'test.other' }, identity)).toBe(false)
  })
})
