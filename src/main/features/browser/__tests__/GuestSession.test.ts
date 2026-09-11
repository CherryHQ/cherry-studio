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
