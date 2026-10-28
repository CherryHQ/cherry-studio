import { afterEach, describe, expect, it } from 'vitest'

import type { CommandOptions } from '../browserUse'
import { GuestSession } from '../session/GuestSession'
import type { KeyStroke } from '../session/InputTransport'
import { createGuest } from './guestFixture'

const sessions: GuestSession[] = []
function createTransport(ownership: 'managed' | 'borrowed') {
  const fixture = createGuest()
  const session = new GuestSession(fixture.guest, ownership)
  sessions.push(session)
  return { ...fixture, session, input: session.input }
}
afterEach(() => {
  for (const session of sessions.splice(0)) session.dispose()
})

const stroke: KeyStroke = { key: 'A', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 8, text: 'A' }

describe('Input transport', () => {
  it('preserves the CDP key, character, text and select-all protocol', async () => {
    const { input, mock } = createTransport('managed')
    await input.keyDown({ ...stroke, selectAll: true })
    await input.char(stroke)
    await input.keyUp(stroke)
    await input.insertText('中文🙂')
    expect(await input.selectAll()).toBe(true)
    expect(mock.debugger.sendCommand.mock.calls.filter(([method]) => method.startsWith('Input.'))).toEqual([
      [
        'Input.dispatchKeyEvent',
        { key: 'A', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 8, type: 'rawKeyDown', commands: ['selectAll'] }
      ],
      [
        'Input.dispatchKeyEvent',
        {
          key: 'A',
          code: 'KeyA',
          windowsVirtualKeyCode: 65,
          modifiers: 8,
          type: 'char',
          text: 'A',
          unmodifiedText: 'A'
        }
      ],
      ['Input.dispatchKeyEvent', { key: 'A', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 8, type: 'keyUp' }],
      ['Input.insertText', { text: '中文🙂' }],
      ['Input.dispatchKeyEvent', { type: 'rawKeyDown', commands: ['selectAll'] }],
      ['Input.dispatchKeyEvent', { type: 'keyUp' }]
    ])
    expect(mock.sendInputEvent.mock.calls).toEqual([])
  })

  it('delivers complete Unicode key sequences to the borrowed guest', async () => {
    const { input, session, mock } = createTransport('borrowed')
    await session.send('Runtime.enable')
    await input.keyDown(stroke)
    await input.char(stroke)
    await input.keyUp(stroke)
    await input.insertText('中🙂')
    expect(mock.sendInputEvent.mock.calls.map(([event]) => event)).toEqual([
      { type: 'keyDown', keyCode: 'A', modifiers: ['shift'] },
      { type: 'char', keyCode: 'A', modifiers: ['shift'] },
      { type: 'keyUp', keyCode: 'A', modifiers: ['shift'] },
      { type: 'keyDown', keyCode: '中', modifiers: [] },
      { type: 'char', keyCode: '中', modifiers: [] },
      { type: 'keyUp', keyCode: '中', modifiers: [] },
      { type: 'keyDown', keyCode: '🙂', modifiers: [] },
      { type: 'char', keyCode: '🙂', modifiers: [] },
      { type: 'keyUp', keyCode: '🙂', modifiers: [] }
    ])
    expect(mock.debugger.sendCommand.mock.calls.filter(([method]) => method.startsWith('Input.'))).toEqual([])
  })

  it.each([
    ['ArrowLeft', 'Left'],
    ['ArrowUp', 'Up'],
    ['ArrowRight', 'Right'],
    ['ArrowDown', 'Down'],
    ['Escape', 'Esc'],
    ['Enter', 'Return'],
    ['Tab', 'Tab'],
    ['Backspace', 'Backspace'],
    ['Delete', 'Delete'],
    ['Home', 'Home'],
    ['End', 'End'],
    ['PageUp', 'PageUp'],
    ['PageDown', 'PageDown'],
    [' ', 'Space'],
    ['F1', 'F1'],
    ['F2', 'F2'],
    ['F3', 'F3'],
    ['F4', 'F4'],
    ['F5', 'F5'],
    ['F6', 'F6'],
    ['F7', 'F7'],
    ['F8', 'F8'],
    ['F9', 'F9'],
    ['F10', 'F10'],
    ['F11', 'F11'],
    ['F12', 'F12']
  ])('maps DOM %j to the Electron accelerator %j', async (key, accelerator) => {
    const { input, session, mock } = createTransport('borrowed')
    await session.send('Runtime.enable')
    await input.keyDown({ key, modifiers: 7 })
    await input.keyUp({ key, modifiers: 7 })
    expect(mock.sendInputEvent.mock.calls.map(([event]) => event)).toEqual([
      { type: 'keyDown', keyCode: accelerator, modifiers: ['alt', 'control', 'meta'] },
      { type: 'keyUp', keyCode: accelerator, modifiers: ['alt', 'control', 'meta'] }
    ])
  })

  it.each(['cancel', 'timeout'] as const)(
    'releases a native text key after %s without continuing insertion',
    async (failure) => {
      const { input, session, mock } = createTransport('borrowed')
      await session.send('Runtime.enable')
      const abort = new AbortController()
      const options = { signal: abort.signal, deadline: Date.now() + 30000 }
      mock.sendInputEvent.mockImplementation((event) => {
        if (event.type !== 'keyDown') return
        if (failure === 'cancel') abort.abort(new Error('cancelled'))
        else options.deadline = Date.now() - 1
      })
      const insertion = input.insertText('xy', options)
      if (failure === 'cancel') await expect(insertion).rejects.toThrow('cancelled')
      else await expect(insertion).rejects.toMatchObject({ code: 'timeout' })
      expect(mock.sendInputEvent.mock.calls.map(([event]) => event)).toEqual([
        { type: 'keyDown', keyCode: 'x', modifiers: [] },
        { type: 'keyUp', keyCode: 'x', modifiers: [] }
      ])
    }
  )

  it('releases a borrowed key when the debugger is unavailable', async () => {
    const { input, session, mock } = createTransport('borrowed')
    await session.send('Runtime.enable')
    mock.isDevToolsOpened.mockReturnValue(true)
    expect(session.isAvailable()).toBe(false)
    await expect(input.keyUp(stroke)).resolves.toBeUndefined()
    expect(mock.sendInputEvent.mock.calls.map(([event]) => event)).toEqual([
      { type: 'keyUp', keyCode: 'A', modifiers: ['shift'] }
    ])
  })

  it('releases a borrowed key while a dialog is open', async () => {
    const { input, session, mock } = createTransport('borrowed')
    await session.send('Runtime.enable')
    session.pendingDialog = { type: 'alert', message: 'blocked' }
    await expect(input.keyUp(stroke)).resolves.toBeUndefined()
    expect(mock.sendInputEvent.mock.calls.map(([event]) => event)).toEqual([
      { type: 'keyUp', keyCode: 'A', modifiers: ['shift'] }
    ])
  })

  it('skips borrowed key release without throwing when the guest is destroyed', async () => {
    const { input, session, mock } = createTransport('borrowed')
    await session.send('Runtime.enable')
    mock.close()
    await expect(input.keyUp(stroke)).resolves.toBeUndefined()
    expect(mock.sendInputEvent.mock.calls).toEqual([])
  })

  it('releases a borrowed key despite cancelled and expired command options', async () => {
    const { input, session, mock } = createTransport('borrowed')
    await session.send('Runtime.enable')
    await expect(
      input.keyUp(stroke, { signal: AbortSignal.abort(new Error('cancelled')), deadline: Date.now() - 1 })
    ).resolves.toBeUndefined()
    expect(mock.sendInputEvent.mock.calls.map(([event]) => event)).toEqual([
      { type: 'keyUp', keyCode: 'A', modifiers: ['shift'] }
    ])
  })

  it.each(['keyDown', 'char', 'insertText', 'selectAll'] as const)(
    'rejects undeliverable %s calls before guest input',
    async (method) => {
      const { input, session, mock } = createTransport('borrowed')
      const invoke = (options?: CommandOptions) =>
        method === 'insertText'
          ? input.insertText('x', options)
          : method === 'selectAll'
            ? input.selectAll(options)
            : input[method](stroke, options)
      await expect(invoke()).rejects.toMatchObject({ code: 'debugger_unavailable' })
      await session.send('Runtime.enable')
      await expect(invoke({ signal: AbortSignal.abort(new Error('cancelled')) })).rejects.toThrow('cancelled')
      await expect(invoke({ deadline: Date.now() - 1 })).rejects.toMatchObject({ code: 'timeout' })
      session.pendingDialog = { type: 'alert', message: 'blocked' }
      await expect(invoke()).rejects.toMatchObject({ code: 'dialog_open' })
      session.pendingDialog = undefined
      mock.isDevToolsOpened.mockReturnValue(true)
      await expect(invoke()).rejects.toMatchObject({ code: 'debugger_unavailable' })
      expect(mock.sendInputEvent.mock.calls).toEqual([])
      expect(mock.debugger.sendCommand.mock.calls.filter(([command]) => command === 'Runtime.evaluate')).toEqual([])
    }
  )
})
