import { EventEmitter } from 'node:events'

import type { Protocol } from 'devtools-protocol'
import { afterEach, assertType, describe, expect, expectTypeOf, it, vi } from 'vitest'

import { Signal } from '@main/core/lifecycle'
import type { WebviewAnnotation } from '@shared/types/webviewAnnotation'

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
  it('invalidates refs and rejects work when the renderer dies without detach or destruction', async () => {
    const { session, mock } = setup()
    const fallback = mock.debugger.sendCommand.getMockImplementation()!
    mock.debugger.sendCommand.mockImplementation((method, params) => {
      if (method === 'DOM.getDocument') return Promise.resolve({ root: { backendNodeId: 1 } })
      if (method === 'Accessibility.queryAXTree')
        return Promise.resolve({ nodes: [{ backendDOMNodeId: 2, role: { value: 'button' }, name: { value: 'Go' } }] })
      return fallback(method, params)
    })
    const { matches } = await session.find({ role: 'button' })
    expect(session.resolveRef(matches[0].ref)).toBe(2)
    const started = new Signal<void>()
    mock.debugger.sendCommand.mockImplementation(async () => {
      started.resolve()
      return new Promise(() => undefined)
    })
    const pending = expect(session.send('Runtime.enable')).rejects.toMatchObject({ code: 'debugger_unavailable' })
    await started
    mock.crash()
    expect(() => session.resolveRef(matches[0].ref)).toThrow(expect.objectContaining({ code: 'stale_ref' }))
    await pending
    const count = mock.debugger.sendCommand.mock.calls.length
    await expect(session.send('Runtime.enable')).rejects.toMatchObject({ code: 'debugger_unavailable' })
    expect(mock.debugger.sendCommand.mock.calls).toHaveLength(count)
    expect(mock.debugger.isAttached()).toBe(true)
    expect(mock.isDestroyed()).toBe(false)
    expect(mock.close).not.toHaveBeenCalled()
  })

  it('rearms a crashed session on dom-ready without reviving old refs', async () => {
    const { session, mock } = setup()
    const fallback = mock.debugger.sendCommand.getMockImplementation()!
    mock.debugger.sendCommand.mockImplementation((method, params) => {
      if (method === 'DOM.getDocument') return Promise.resolve({ root: { backendNodeId: 1 } })
      if (method === 'Accessibility.queryAXTree')
        return Promise.resolve({ nodes: [{ backendDOMNodeId: 2, role: { value: 'button' }, name: { value: 'Go' } }] })
      return fallback(method, params)
    })
    const { matches } = await session.find({ role: 'button' })
    mock.crash()
    await expect(session.send('Runtime.enable')).rejects.toMatchObject({ code: 'debugger_unavailable' })
    mock.recover()
    await expect(session.send('Runtime.enable')).resolves.toBeDefined()
    expect(mock.debugger.attach).toHaveBeenCalledTimes(2)
    expect(() => session.resolveRef(matches[0].ref)).toThrow(expect.objectContaining({ code: 'stale_ref' }))
  })

  it.each(['before', 'after'] as const)(
    'dismisses a recovery startup dialog when frame navigation arrives %s the dialog',
    async (navigationOrder) => {
      vi.useFakeTimers()
      const { guest, mock } = createGuest()
      const session = new GuestSession(guest, 'managed')
      sessions.push(session)
      await session.send('Runtime.enable')
      mock.crash()
      mock.isCrashed.mockReturnValue(false)
      const commands = mock.debugger.sendCommand.mock.calls.length
      await expect(session.send('Runtime.enable')).rejects.toMatchObject({ code: 'debugger_unavailable' })
      await expect(session.send('Page.handleJavaScriptDialog', { accept: false })).rejects.toMatchObject({
        code: 'debugger_unavailable'
      })
      const operation = vi.fn(async () => 'must not execute')
      await expect(session.run(operation)).rejects.toMatchObject({ code: 'debugger_unavailable' })
      await expect(session.observe()).rejects.toMatchObject({ code: 'debugger_unavailable' })
      await expect(session.snapshot()).rejects.toMatchObject({ code: 'debugger_unavailable' })
      expect(operation).not.toHaveBeenCalled()
      expect(mock.debugger.sendCommand.mock.calls).toHaveLength(commands)

      const navigate = () =>
        mock.debugger.emit('message', {}, 'Page.frameNavigated', { frame: { id: 'main', loaderId: 'recovered' } })
      if (navigationOrder === 'before') navigate()
      const dialog = { type: 'alert', message: 'Startup alert' }
      mock.debugger.emit('message', {}, 'Page.javascriptDialogOpening', dialog)
      expect.soft(session.pendingDialog).toEqual(dialog)
      if (navigationOrder === 'after') navigate()
      expect.soft(session.pendingDialog).toEqual(dialog)
      await expect.soft(session.send('Runtime.enable')).rejects.toMatchObject({ code: 'dialog_open' })
      await vi.advanceTimersByTimeAsync(60_000)
      expect(mock.debugger.sendCommand).toHaveBeenCalledWith('Page.handleJavaScriptDialog', { accept: false })
      expect(session.pendingDialog).toBeUndefined()
      expect(session.takeEvents()).toEqual({ dismissedDialog: dialog })
      expect(session.isAvailable()).toBe(false)
      await expect(session.send('Runtime.enable')).rejects.toMatchObject({ code: 'debugger_unavailable' })
      mock.recover()
      await expect(session.send('Runtime.enable')).resolves.toBeDefined()
    }
  )

  it('retains recovered startup requests before and after dom-ready', async () => {
    const { guest, mock } = createGuest()
    const session = new GuestSession(guest, 'managed')
    sessions.push(session)
    await session.send('Runtime.enable')
    mock.crash()
    mock.isCrashed.mockReturnValue(false)
    const requests: string[] = []
    session.onEvent((event) => {
      if (event.method === 'Network.requestWillBeSent') requests.push(event.params.request.url)
    })
    mock.debugger.emit('message', {}, 'Network.requestWillBeSent', {
      requestId: 'startup',
      type: 'Document',
      request: { method: 'GET', url: 'https://example.com/startup', headers: {} }
    })
    expect.soft(requests).toEqual(['https://example.com/startup'])
    expect(() => session.networkRequests()).toThrow(expect.objectContaining({ code: 'debugger_unavailable' }))
    mock.recover()
    await session.send('Runtime.enable')
    mock.debugger.emit('message', {}, 'Network.loadingFinished', { requestId: 'startup' })
    expect(session.networkRequests().requests).toEqual([
      expect.objectContaining({ requestId: 'startup', url: 'https://example.com/startup', state: 'completed' })
    ])
  })

  it('re-arms download observation once when a managed guest recovers', () => {
    const fixture = createGuest()
    const session = new GuestSession(fixture.guest, 'managed')
    sessions.push(session)
    expect(fixture.mock.session.listenerCount('will-download')).toBe(1)
    fixture.mock.crash()
    expect(fixture.mock.session.listenerCount('will-download')).toBe(0)
    fixture.mock.recover()
    expect(fixture.mock.session.listenerCount('will-download')).toBe(1)
    fixture.mock.crash()
    fixture.mock.recover()
    expect(fixture.mock.session.listenerCount('will-download')).toBe(1)

    const item = Object.assign(new EventEmitter(), { getFilename: () => 'after-recovery.txt' })
    fixture.mock.session.emit('will-download', {}, item, fixture.guest)
    expect(session.takeEvents()).toEqual({ downloads: [{ filename: 'after-recovery.txt', state: 'progressing' }] })
    expect(session.busy).toBe(true)
    item.emit('done', {}, 'completed')
    expect(session.busy).toBe(false)
  })

  it.each(['completed', 'cancelled', 'interrupted'])(
    'keeps an in-flight managed download busy across a crash until it is %s',
    async (state) => {
      const fixture = createGuest()
      const session = new GuestSession(fixture.guest, 'managed')
      sessions.push(session)
      const item = Object.assign(new EventEmitter(), { getFilename: () => 'in-flight.txt' })
      fixture.mock.session.emit('will-download', {}, item, fixture.guest)
      expect(session.busy).toBe(true)
      fixture.mock.crash()
      expect(session.busy).toBe(true)
      expect(item.listenerCount('updated')).toBe(1)
      expect(item.listenerCount('done')).toBe(1)
      fixture.mock.recover()
      await session.send('Runtime.enable')
      expect(session.busy).toBe(true)
      item.emit('done', {}, state)
      expect(session.takeEvents()).toEqual({ downloads: [{ filename: 'in-flight.txt', state }] })
      expect(item.listenerCount('updated')).toBe(0)
      expect(item.listenerCount('done')).toBe(0)
      expect(session.busy).toBe(false)
    }
  )

  it('keeps the same in-flight download through two crash/recovery cycles and reports completion once', async () => {
    const fixture = createGuest()
    const session = new GuestSession(fixture.guest, 'managed')
    sessions.push(session)
    const item = Object.assign(new EventEmitter(), { getFilename: () => 'two-cycles.txt' })
    fixture.mock.session.emit('will-download', {}, item, fixture.guest)
    expect(session.busy).toBe(true)
    expect(item.listenerCount('updated')).toBe(1)
    expect(item.listenerCount('done')).toBe(1)
    for (let cycle = 0; cycle < 2; cycle++) {
      fixture.mock.crash()
      expect(session.busy).toBe(true)
      expect(item.listenerCount('updated')).toBe(1)
      expect(item.listenerCount('done')).toBe(1)
      fixture.mock.recover()
      await session.send('Runtime.enable')
      expect(session.busy).toBe(true)
      expect(item.listenerCount('updated')).toBe(1)
      expect(item.listenerCount('done')).toBe(1)
    }
    item.emit('done', {}, 'completed')
    expect(session.takeEvents()).toEqual({ downloads: [{ filename: 'two-cycles.txt', state: 'completed' }] })
    expect(session.takeEvents()).toEqual({})
    expect(item.listenerCount('updated')).toBe(0)
    expect(item.listenerCount('done')).toBe(0)
    expect(session.busy).toBe(false)
  })

  it('preserves recorded download progress and keeps receiving updates while crashed', () => {
    const fixture = createGuest()
    const session = new GuestSession(fixture.guest, 'managed')
    sessions.push(session)
    const item = Object.assign(new EventEmitter(), { getFilename: () => 'progress.txt' })
    fixture.mock.session.emit('will-download', {}, item, fixture.guest)
    item.emit('updated', {}, 'interrupted')
    fixture.mock.crash()
    expect(session.takeEvents()).toEqual({ downloads: [{ filename: 'progress.txt', state: 'interrupted' }] })
    item.emit('updated', {}, 'progressing')
    expect(session.takeEvents()).toEqual({ downloads: [{ filename: 'progress.txt', state: 'progressing' }] })
    item.emit('done', {}, 'completed')
    expect(session.takeEvents()).toEqual({ downloads: [{ filename: 'progress.txt', state: 'completed' }] })
    expect(session.busy).toBe(false)
  })

  it.each(['active', 'crashed', 'recovered'])(
    'disposes an in-flight download in a %s managed session',
    async (phase) => {
      const fixture = createGuest()
      const session = new GuestSession(fixture.guest, 'managed')
      sessions.push(session)
      const item = Object.assign(new EventEmitter(), { getFilename: () => 'disposed.txt' })
      fixture.mock.session.emit('will-download', {}, item, fixture.guest)
      if (phase !== 'active') fixture.mock.crash()
      if (phase === 'recovered') {
        fixture.mock.recover()
        await session.send('Runtime.enable')
      }
      expect(session.busy).toBe(true)
      expect(item.listenerCount('updated')).toBe(1)
      expect(item.listenerCount('done')).toBe(1)
      session.dispose()
      expect(fixture.mock.session.listenerCount('will-download')).toBe(0)
      expect(item.listenerCount('updated')).toBe(0)
      expect(item.listenerCount('done')).toBe(0)
      expect(session.busy).toBe(false)
      expect(session.takeEvents()).toEqual({})
      item.emit('updated', {}, 'progressing')
      item.emit('done', {}, 'completed')
      expect(session.takeEvents()).toEqual({})
    }
  )

  it.each([false, true])(
    'drops borrowed download tracking on the last observer release (crashed: %s)',
    async (crash) => {
      const { guest, session, mock } = setup()
      const handle = await session.observe()
      const item = Object.assign(new EventEmitter(), { getFilename: () => 'borrowed.txt' })
      mock.session.emit('will-download', {}, item, guest)
      expect(session.busy).toBe(true)
      if (crash) mock.crash()
      expect(session.busy).toBe(true)
      expect(item.listenerCount('updated')).toBe(1)
      expect(item.listenerCount('done')).toBe(1)
      handle.dispose()
      expect(mock.session.listenerCount('will-download')).toBe(0)
      expect(item.listenerCount('updated')).toBe(0)
      expect(item.listenerCount('done')).toBe(0)
      expect(session.busy).toBe(false)
      expect(session.takeEvents()).toEqual({})
      item.emit('done', {}, 'completed')
      expect(session.takeEvents()).toEqual({})
    }
  )

  it('immediately restores network observation after a managed guest recovers', async () => {
    const { guest, mock } = createGuest()
    const session = new GuestSession(guest, 'managed')
    sessions.push(session)
    await session.send('Runtime.enable')
    const before = mock.debugger.sendCommand.mock.calls.filter(([method]) => method === 'Network.enable').length
    mock.crash()
    mock.recover()
    // CDP stops delivering Network events when detached, so check the connection and domain re-enablement.
    await vi.waitFor(() => {
      expect(mock.debugger.isAttached()).toBe(true)
      expect(
        mock.debugger.sendCommand.mock.calls.filter(([method]) => method === 'Network.enable').length
      ).toBeGreaterThan(before)
    })
    mock.debugger.emit('message', {}, 'Network.requestWillBeSent', {
      requestId: 'after-recovery',
      type: 'Fetch',
      request: { method: 'GET', url: 'https://example.com/after', headers: {} }
    })
    expect(session.networkRequests().requests.map((request) => request.url)).toContain('https://example.com/after')
  })

  it('reattaches and restores network observation when Electron detached after a crash', async () => {
    const { guest, mock } = createGuest()
    const session = new GuestSession(guest, 'managed')
    sessions.push(session)
    await session.send('Runtime.enable')
    const before = mock.debugger.sendCommand.mock.calls.filter(([method]) => method === 'Network.enable').length
    mock.crash()
    mock.debugger.detach()
    mock.recover()
    await vi.waitFor(() => {
      expect(mock.debugger.isAttached()).toBe(true)
      expect(
        mock.debugger.sendCommand.mock.calls.filter(([method]) => method === 'Network.enable').length
      ).toBeGreaterThan(before)
    })
  })

  it('leaves a borrowed guest without an observer detached after recovery', async () => {
    const { session, mock } = setup()
    await session.send('Runtime.enable')
    mock.crash()
    mock.recover()
    expect(mock.debugger.isAttached()).toBe(false)
  })

  it('waits for recovery before dispatching a concurrent command', async () => {
    const { guest, mock } = createGuest()
    const session = new GuestSession(guest, 'managed')
    sessions.push(session)
    await session.send('Runtime.enable')
    const started = new Signal<void>()
    const resume = new Signal<object>()
    const fallback = mock.debugger.sendCommand.getMockImplementation()!
    mock.debugger.sendCommand.mockImplementation((method, params) => {
      if (method === 'Page.enable') {
        started.resolve()
        return Promise.resolve(resume)
      }
      return fallback(method, params)
    })
    mock.crash()
    mock.recover()
    await started
    const command = session.send('Runtime.enable')
    expect(mock.debugger.attach).toHaveBeenCalledTimes(1)
    resume.resolve({})
    await expect(command).resolves.toBeDefined()
    expect(mock.debugger.attach).toHaveBeenCalledTimes(1)
  })

  it('detaches after recovery initialization fails and retries on the next command', async () => {
    const { guest, mock } = createGuest()
    const session = new GuestSession(guest, 'managed')
    sessions.push(session)
    await session.send('Runtime.enable')
    mock.crash()
    mock.debugger.sendCommand.mockRejectedValueOnce(new Error('recovery failed'))
    mock.recover()
    await vi.waitFor(() => expect(mock.debugger.isAttached()).toBe(false))
    await expect(session.send('Runtime.enable')).resolves.toBeDefined()
    expect(mock.debugger.isAttached()).toBe(true)
  })

  it('keeps observing downloads after recovery while an observe() handle is held', async () => {
    const { session, mock } = setup()
    const handle = await session.observe()
    mock.crash()
    mock.recover()
    expect(mock.session.listenerCount('will-download')).toBe(1)
    handle.dispose()
    expect(mock.session.listenerCount('will-download')).toBe(0)
  })

  it('cancels queued actions on death and prevents an active action from succeeding', async () => {
    const { session, mock } = setup()
    const started = new Signal<void>()
    const resume = new Signal<void>()
    const active = session.run(async () => {
      started.resolve()
      await resume
      return 'stale'
    })
    const rejected = expect(active).rejects.toMatchObject({ code: 'debugger_unavailable' })
    await started
    let executed = false
    const queued = expect(
      session.run(async () => {
        executed = true
      })
    ).rejects.toMatchObject({ code: 'debugger_unavailable' })
    mock.crash()
    await queued
    resume.resolve()
    await rejected
    expect(executed).toBe(false)
  })

  it('captures an occluded webview and stops producing frames after the result', async () => {
    const { session, mock } = setup()
    mock.getType.mockReturnValue('webview')
    await session.send('Runtime.enable')
    mock.debugger.sendCommand.mockImplementation(async () => {
      if (!mock.isCapturing()) throw new Error('No compositor frames')
      return { data: 'image' }
    })
    expect(await session.send('Page.captureScreenshot')).toEqual({ data: 'image' })
    expect(mock.isCapturing()).toBe(false)
  })

  it.each(['abort', 'deadline', 'dispose', 'failure'])('releases screenshot frame capture on %s', async (reason) => {
    vi.useFakeTimers()
    const { session, mock } = setup()
    mock.getType.mockReturnValue('webview')
    await session.send('Runtime.enable')
    const started = new Signal<void>()
    mock.debugger.sendCommand.mockImplementation(async () => {
      started.resolve()
      if (reason === 'failure') throw new Error('Capture failed')
      return new Promise(() => undefined)
    })
    const abort = new AbortController()
    const result = session.send('Page.captureScreenshot', undefined, {
      signal: abort.signal,
      deadline: Date.now() + 100
    })
    const rejected = expect(result).rejects.toThrow()
    await started
    if (reason === 'abort') abort.abort(new Error('Cancelled'))
    if (reason === 'deadline') await vi.advanceTimersByTimeAsync(100)
    if (reason === 'dispose') session.dispose()
    await rejected
    expect(mock.isCapturing()).toBe(false)
  })

  it('keeps frames available to another screenshot when a caller cancels', async () => {
    const { session, mock } = setup()
    mock.getType.mockReturnValue('webview')
    await session.send('Runtime.enable')
    const bothStarted = new Signal<void>()
    const finish = new Signal<{ data: string }>()
    let calls = 0
    mock.debugger.sendCommand.mockImplementation(async () => {
      if (++calls === 2) bothStarted.resolve()
      return finish
    })
    const abort = new AbortController()
    const first = expect(session.send('Page.captureScreenshot', undefined, { signal: abort.signal })).rejects.toThrow()
    const second = session.send('Page.captureScreenshot')
    await bothStarted
    abort.abort()
    await first
    expect(mock.isCapturing()).toBe(true)
    finish.resolve({ data: 'image' })
    expect(await second).toEqual({ data: 'image' })
    expect(mock.isCapturing()).toBe(false)
  })

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

  it('cancels a queued caller without interrupting the current lease or dispatching its operation later', async () => {
    const { session } = setup()
    const started = new Signal<void>()
    const resume = new Signal<void>()
    const active = session.run(async () => {
      started.resolve()
      await resume
      return 'retained'
    })
    await started
    const abort = new AbortController()
    let dispatched = false
    const queued = session.run(
      async () => {
        dispatched = true
      },
      { signal: abort.signal }
    )
    const rejected = expect(queued).rejects.toThrow('cancelled queued call')
    abort.abort(new Error('cancelled queued call'))
    await rejected
    expect(dispatched).toBe(false)
    resume.resolve()
    expect(await active).toBe('retained')
    expect(await session.run(async () => 'next')).toBe('next')
    expect(dispatched).toBe(false)
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
      session.onEvent((event) => {
        if (event.method === 'Network.responseReceived') {
          expectTypeOf(event.params).toEqualTypeOf<Protocol.Network.ResponseReceivedEvent>()
          // @ts-expect-error Event narrowing excludes fields belonging to another event.
          void event.params.exceptionDetails
        }
      })
      void session.send('Network.enable')
      void session.send('Network.enable', { maxTotalBufferSize: 1024 }, { deadline: 100 })
      void session.send('Page.captureScreenshot', { format: 'png' })
      // @ts-expect-error Misspelled protocol methods must fail compilation.
      void session.send('Page.navigte', { url: 'https://example.com' })
      // @ts-expect-error Valid CDP methods outside the whitelist remain unavailable.
      void session.send('Target.createTarget', { url: 'https://example.com' })
      // @ts-expect-error A required parameter object cannot be omitted.
      void session.send('Page.navigate')
      // @ts-expect-error Required parameter fields cannot be omitted.
      void session.send('Page.navigate', {})
      // @ts-expect-error Parameters must match the selected method.
      void session.send('Input.insertText', { text: 123 })
      // @ts-expect-error Parameters from another method cannot widen inference.
      void session.send('Input.insertText', { url: 'https://example.com' })
      // @ts-expect-error No-parameter commands reject arbitrary parameter objects.
      void session.send('Page.getFrameTree', {})
      // @ts-expect-error Official protocol enums constrain field values.
      void session.send('Page.captureScreenshot', { format: 'gif' })
      // @ts-expect-error Callers cannot override the protocol's response type.
      void session.send<{ invented: true }>('Page.getFrameTree')
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

  it.each(['abort', 'deadline'])('stops initialization after its last caller leaves via %s', async (reason) => {
    vi.useFakeTimers()
    const { session, mock } = setup()
    let resume!: (value: object) => void
    const fallback = mock.debugger.sendCommand.getMockImplementation()!
    mock.debugger.sendCommand.mockImplementation((method, params) =>
      method === 'Page.enable'
        ? new Promise((resolve) => {
            resume = resolve
          })
        : fallback(method, params)
    )
    const controller = new AbortController()
    const result = session.send(
      'DOM.describeNode',
      { backendNodeId: 1 },
      {
        signal: controller.signal,
        deadline: Date.now() + 100
      }
    )
    const rejected = expect(result).rejects.toThrow(reason === 'abort' ? 'Cancelled' : 'timeout')
    if (reason === 'abort') controller.abort(new Error('Cancelled'))
    else await vi.advanceTimersByTimeAsync(101)
    await rejected
    resume({})
    await vi.advanceTimersByTimeAsync(0)
    expect(mock.debugger.sendCommand.mock.calls.map(([method]) => method)).toEqual(['Page.enable'])
    expect(session.isAvailable()).toBe(false)
    mock.debugger.sendCommand.mockImplementation(fallback)
    await session.send('DOM.describeNode', { backendNodeId: 2 })
    expect(session.documentId).toBe('document-1')
  })

  it('keeps initialization alive for another caller when one caller aborts', async () => {
    const { session, mock } = setup()
    let resume!: (value: object) => void
    const fallback = mock.debugger.sendCommand.getMockImplementation()!
    mock.debugger.sendCommand.mockImplementation((method, params) =>
      method === 'Page.enable'
        ? new Promise((resolve) => {
            resume = resolve
          })
        : fallback(method, params)
    )
    const controller = new AbortController()
    const rejected = expect(
      session.send('DOM.describeNode', { backendNodeId: 1 }, { signal: controller.signal })
    ).rejects.toThrow('Cancelled')
    const survivor = session.send('DOM.describeNode', { backendNodeId: 2 })
    controller.abort(new Error('Cancelled'))
    await rejected
    resume({})
    await survivor
    expect(session.documentId).toBe('document-1')
    expect(session.isAvailable()).toBe(true)
  })

  it('rejects in-flight commands and releases listeners after native guest destruction', async () => {
    const { session, mock } = setup()
    const debuggerEvents = mock.debugger
    const electronSession = mock.session
    const observation = await session.observe()
    const started = new Signal<void>()
    debuggerEvents.sendCommand.mockImplementation(() => {
      started.resolve()
      return new Promise(() => undefined)
    })
    const command = session.send('Runtime.evaluate', { expression: '1' })
    const rejected = expect(command).rejects.toMatchObject({ code: 'debugger_unavailable' })
    await started

    expect(() => mock.close()).not.toThrow()
    await rejected
    expect(() => observation.dispose()).not.toThrow()
    expect(() => session.dispose()).not.toThrow()
    expect(debuggerEvents.listenerCount('message')).toBe(0)
    expect(debuggerEvents.listenerCount('detach')).toBe(0)
    expect(electronSession.listenerCount('will-download')).toBe(0)
    expect(mock.listenerCount('destroyed')).toBe(0)
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

describe('GuestSession annotation context lifetime', () => {
  const annotation: WebviewAnnotation = {
    id: '00000000-0000-4000-8000-000000000001',
    comment: 'Adjust this button',
    element: { selector: '#submit', tagName: 'button', text: 'Submit', ariaLabel: null, role: 'button' }
  }

  it('ignores destruction of an unrelated context while creating the annotation world', async () => {
    const { session, mock } = setup()
    const fallback = mock.debugger.sendCommand.getMockImplementation()!
    const world = Promise.withResolvers<object>()
    const started = Promise.withResolvers<void>()
    mock.debugger.sendCommand.mockImplementation(async (method, params) => {
      if (method === 'Page.createIsolatedWorld') {
        started.resolve()
        return world.promise
      }
      if (method === 'Runtime.evaluate') return { result: { objectId: 'submit' } }
      if (method === 'DOM.describeNode') return { node: { backendNodeId: 1 } }
      if (method === 'Accessibility.getAXNodeAndAncestors')
        return {
          nodes: [
            {
              nodeId: 'submit',
              backendDOMNodeId: 1,
              ignored: false,
              role: { value: 'button' },
              name: { value: 'Submit' }
            }
          ]
        }
      return fallback(method, params)
    })
    const capture = session.describeElement(annotation, { remaining: 100 })
    await started.promise
    mock.debugger.emit('message', {}, 'Runtime.executionContextDestroyed', { executionContextId: 999 })
    world.resolve({ executionContextId: 73 })
    await expect(capture).resolves.toMatchObject({ status: 'available', tree: { name: 'Submit' } })
  })

  it.each([
    ['Runtime.executionContextsCleared', 'creation'],
    ['Runtime.executionContextDestroyed', 'creation'],
    ['Runtime.executionContextsCleared', 'capture'],
    ['Runtime.executionContextDestroyed', 'capture']
  ])('discards %s during %s and recovers on the next capture', async (event, stage) => {
    const { session, mock } = setup()
    const fallback = mock.debugger.sendCommand.getMockImplementation()!
    const paused = Promise.withResolvers<object>()
    const started = Promise.withResolvers<void>()
    let contextId = 73
    let pause = true
    mock.debugger.sendCommand.mockImplementation(async (method, params) => {
      if (method === 'Page.createIsolatedWorld') {
        if (pause && stage === 'creation') {
          started.resolve()
          return paused.promise
        }
        return { executionContextId: contextId }
      }
      if (method === 'Runtime.evaluate') {
        if ((params as { contextId: number }).contextId !== contextId) throw new Error('Invalid context')
        if (pause && stage === 'capture') {
          started.resolve()
          return paused.promise
        }
        return { result: { objectId: 'submit' } }
      }
      if (method === 'DOM.describeNode') return { node: { backendNodeId: 1 } }
      if (method === 'Accessibility.getAXNodeAndAncestors')
        return {
          nodes: [
            {
              nodeId: 'submit',
              backendDOMNodeId: 1,
              ignored: false,
              role: { value: 'button' },
              name: { value: 'Submit' }
            }
          ]
        }
      return fallback(method, params)
    })
    const result = session.describeElement(annotation, { remaining: 100 })
    const rejected = expect(result).rejects.toMatchObject({ code: 'stale_ref' })
    await started.promise
    mock.debugger.emit('message', {}, event, { executionContextId: contextId })
    contextId = 74
    pause = false
    paused.resolve(stage === 'creation' ? { executionContextId: 73 } : { result: { objectId: 'submit' } })
    await rejected
    await expect(session.describeElement(annotation, { remaining: 100 })).resolves.toMatchObject({
      status: 'available',
      tree: { role: 'button', name: 'Submit' }
    })
    mock.debugger.emit('message', {}, 'Runtime.executionContextDestroyed', { executionContextId: 999 })
    await expect(session.describeElement(annotation, { remaining: 100 })).resolves.toMatchObject({
      status: 'available',
      tree: { role: 'button', name: 'Submit' }
    })
    expect(
      mock.debugger.sendCommand.mock.calls.filter(([method]) => method === 'Page.createIsolatedWorld')
    ).toHaveLength(2)
  })
})
