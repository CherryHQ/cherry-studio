import { Signal } from '@main/core/lifecycle'
import type { Protocol } from 'devtools-protocol'
import { afterEach, assertType, describe, expect, expectTypeOf, it, vi } from 'vitest'

import { GuestSession } from '../session/GuestSession'
import { createGuest } from './guestFixture'

const sessions: GuestSession[] = []
function setup() {
  const fixture = createGuest()
  const session = new GuestSession(fixture.guest, 'borrowed')
  sessions.push(session)
  return { ...fixture, session }
}

afterEach(() => {
  sessions.splice(0).forEach((session) => session.dispose())
  vi.useRealTimers()
})

describe('GuestSession command lifetime', () => {
  it('rejects active and queued snapshots when their session is disposed', async () => {
    const { session, mock } = setup()
    await session.send('Runtime.enable')
    const started = new Signal<void>()
    mock.debugger.sendCommand.mockImplementation(async () => {
      started.resolve()
      return new Promise(() => undefined)
    })
    const active = expect(session.snapshot()).rejects.toMatchObject({ code: 'debugger_unavailable' })
    await started
    const queued = expect(session.snapshot()).rejects.toMatchObject({ code: 'debugger_unavailable' })
    session.dispose()
    await Promise.all([active, queued])
    await expect(session.snapshot()).rejects.toMatchObject({ code: 'debugger_unavailable' })
    expect(session.busy).toBe(false)
  })

  it('rejects queued actions on disposal without waiting for the active action', async () => {
    const { session } = setup()
    const started = new Signal<void>()
    const resume = new Signal<void>()
    const active = session.run(async () => {
      started.resolve()
      await resume
    })
    await started
    let executed = false
    const queued = expect(
      session.run(async () => {
        executed = true
      })
    ).rejects.toMatchObject({ code: 'debugger_unavailable' })
    session.dispose()
    try {
      await queued
      expect(executed).toBe(false)
      await expect(session.run(async () => 'late')).rejects.toMatchObject({ code: 'debugger_unavailable' })
    } finally {
      resume.resolve()
      await active
    }
    expect(session.busy).toBe(false)
  })

  it('interrupts delays on disposal and rejects delays started afterward', async () => {
    const { session } = setup()
    const paused = expect(session.pause(60_000)).rejects.toMatchObject({ code: 'debugger_unavailable' })
    session.dispose()
    await paused
    await expect(session.pause(0)).rejects.toMatchObject({ code: 'debugger_unavailable' })
  })

  it('checks method-specific inputs and infers official response types', () => {
    assertType<(session: GuestSession) => void>((session) => {
      expectTypeOf(session.send('Page.navigate', { url: 'https://example.com' })).toEqualTypeOf<
        Promise<Protocol.Page.NavigateResponse>
      >()
      expectTypeOf(session.send('Page.getFrameTree', undefined, { deadline: 100 })).toEqualTypeOf<
        Promise<Protocol.Page.GetFrameTreeResponse>
      >()
      expectTypeOf(session.send('Runtime.enable')).toEqualTypeOf<Promise<void>>()
      session.send('Network.enable')
      session.send('Network.enable', { maxTotalBufferSize: 1024 }, { deadline: 100 })
      session.send('Page.captureScreenshot', { format: 'png' })
      // @ts-expect-error Misspelled protocol methods must fail compilation.
      session.send('Page.navigte', { url: 'https://example.com' })
      // @ts-expect-error Valid CDP methods outside the whitelist remain unavailable.
      session.send('Target.createTarget', { url: 'https://example.com' })
      // @ts-expect-error A required parameter object cannot be omitted.
      session.send('Page.navigate')
      // @ts-expect-error Required parameter fields cannot be omitted.
      session.send('Page.navigate', {})
      // @ts-expect-error Parameters must match the selected method.
      session.send('Input.insertText', { text: 123 })
      // @ts-expect-error Parameters from another method cannot widen inference.
      session.send('Input.insertText', { url: 'https://example.com' })
      // @ts-expect-error No-parameter commands reject arbitrary parameter objects.
      session.send('Page.getFrameTree', {})
      // @ts-expect-error Official protocol enums constrain field values.
      session.send('Page.captureScreenshot', { format: 'gif' })
      // @ts-expect-error Callers cannot override the protocol's response type.
      session.send<{ invented: true }>('Page.getFrameTree')
    })
  })

  it('shares one initialization across concurrent commands and refuses unlisted commands', async () => {
    const { session, mock } = setup()
    // @ts-expect-error Runtime callers must also be rejected for commands outside the whitelist.
    await expect(session.send('Target.createTarget')).rejects.toMatchObject({ code: 'not_allowed' })
    expect(mock.debugger.isAttached()).toBe(false)
    await Promise.all([
      session.send('DOM.describeNode', { backendNodeId: 1 }),
      session.send('DOM.describeNode', { backendNodeId: 2 })
    ])
    expect(mock.debugger.attach).toHaveBeenCalledOnce()
    expect(mock.debugger.sendCommand.mock.calls.filter(([method]) => method === 'Page.enable')).toHaveLength(1)
    expect(session.documentId).toBe('document-1')
    expect(session.busy).toBe(false)
  })

  it('rejects the command that opens a dialog without replaying it after dismissal', async () => {
    const { session, mock } = setup()
    await session.send('Runtime.enable')
    let complete!: (value: unknown) => void
    mock.debugger.sendCommand.mockImplementation(async (method) =>
      method === 'Runtime.evaluate'
        ? new Promise((resolve) => {
            complete = resolve
          })
        : {}
    )
    const result = session.send('Runtime.evaluate', { expression: 'confirm("Continue?")' })
    const assertion = expect(result).rejects.toMatchObject({ code: 'dialog_open', dialog: { type: 'confirm' } })
    await vi.waitFor(() => expect(complete).toBeTypeOf('function'))
    mock.debugger.emit('message', {}, 'Page.javascriptDialogOpening', { type: 'confirm', message: 'Continue?' })
    await assertion
    await expect(session.send('Runtime.evaluate', { expression: '1' })).rejects.toMatchObject({ code: 'dialog_open' })
    await session.send('Page.handleJavaScriptDialog', { accept: false })
    complete({ result: { value: false } })
    expect(session.pendingDialog).toBeUndefined()
    expect(mock.debugger.sendCommand.mock.calls.filter(([method]) => method === 'Runtime.evaluate')).toHaveLength(1)
  })

  it('bounds initialization and never issues the requested command after a timeout', async () => {
    vi.useFakeTimers()
    const { session, mock } = setup()
    mock.debugger.sendCommand.mockImplementation(() => new Promise(() => undefined))
    const assertion = expect(session.send('DOM.describeNode', { backendNodeId: 1 })).rejects.toMatchObject({
      code: 'timeout'
    })
    await vi.advanceTimersByTimeAsync(5_001)
    await assertion
    expect(session.isAvailable()).toBe(false)
    expect(mock.debugger.sendCommand.mock.calls.some(([method]) => method === 'DOM.describeNode')).toBe(false)
  })

  it('aborts a pending command and removes its listeners on disposal', async () => {
    const { session, mock } = setup()
    await session.send('Runtime.enable')
    mock.debugger.sendCommand.mockImplementation(() => new Promise(() => undefined))
    const abort = new AbortController()
    const assertion = expect(
      session.send('Runtime.evaluate', { expression: '1' }, { signal: abort.signal })
    ).rejects.toThrow('Cancelled')
    abort.abort(new Error('Cancelled'))
    await assertion
    session.dispose()
    expect(mock.debugger.listenerCount('message')).toBe(0)
    expect(mock.debugger.listenerCount('detach')).toBe(0)
    expect(mock.listenerCount('destroyed')).toBe(0)
  })

  it('does not detach another debugger and can reattach after DevTools closes', async () => {
    const { session, mock } = setup()
    mock.debugger.attach()
    await expect(session.send('Runtime.enable')).rejects.toMatchObject({ code: 'debugger_unavailable' })
    expect(mock.debugger.isAttached()).toBe(true)
    mock.debugger.detach()
    await session.send('Runtime.enable')
    mock.isDevToolsOpened.mockReturnValue(true)
    mock.debugger.detach()
    await expect(session.send('Runtime.enable')).rejects.toMatchObject({ code: 'debugger_unavailable' })
    mock.isDevToolsOpened.mockReturnValue(false)
    await session.send('Runtime.enable')
    expect(session.isAvailable()).toBe(true)
  })
})
