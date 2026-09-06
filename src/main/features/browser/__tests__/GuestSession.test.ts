import { afterEach, describe, expect, it, vi } from 'vitest'

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
  it('shares one initialization across concurrent commands and refuses unlisted commands', async () => {
    const { session, mock } = setup()
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
    await expect(session.send('Runtime.evaluate')).rejects.toMatchObject({ code: 'dialog_open' })
    await session.send('Page.handleJavaScriptDialog', { accept: false })
    complete({ result: { value: false } })
    expect(session.pendingDialog).toBeUndefined()
    expect(mock.debugger.sendCommand.mock.calls.filter(([method]) => method === 'Runtime.evaluate')).toHaveLength(1)
  })

  it('bounds initialization and never issues the requested command after a timeout', async () => {
    vi.useFakeTimers()
    const { session, mock } = setup()
    mock.debugger.sendCommand.mockImplementation(() => new Promise(() => undefined))
    const assertion = expect(session.send('DOM.describeNode')).rejects.toMatchObject({ code: 'timeout' })
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
    const assertion = expect(session.send('Runtime.evaluate', {}, { signal: abort.signal })).rejects.toThrow(
      'Cancelled'
    )
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
