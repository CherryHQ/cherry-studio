import { JSDOM } from 'jsdom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { selectOption } from '../actions/forms'
import { pressKey, typeText } from '../actions/keyboard'
import { click, hover } from '../actions/mouse'
import { resolveTarget } from '../actions/resolveTarget'
import { settleAction } from '../actions/settle'
import { GuestSession } from '../session/GuestSession'
import { createGuest } from './guestFixture'

let dom: JSDOM
let session: GuestSession
let mock: ReturnType<typeof createGuest>['mock']
let target: Element
let hit: Element
let quads: number[][]
let commands: Array<{ method: string; params: any }>
let rejectFirstInput = false
beforeEach(() => {
  dom = new JSDOM(
    '<button id="button">Save <span>now</span></button><input id="text" value="old"><select><option value="a">Alpha</option><option value="b">Beta</option></select>',
    { runScripts: 'outside-only' }
  )
  const fixture = createGuest()
  mock = fixture.mock
  session = new GuestSession(fixture.guest, 'managed')
  vi.spyOn(session, 'resolveRef').mockImplementation((ref) => {
    if (ref !== 'e1') throw new Error('stale_ref')
    return 1
  })
  target = dom.window.document.querySelector('button')!
  hit = target
  quads = [
    [10, 10, 110, 10, 110, 50, 10, 50],
    [0, 0, 1, 0, 1, 1, 0, 1]
  ]
  commands = []
  rejectFirstInput = false
  mock.debugger.sendCommand.mockImplementation(async (method, params: any = {}) => {
    commands.push({ method, params })
    if (method === 'Page.getFrameTree') return { frameTree: { frame: { id: 'main', loaderId: 'doc' } } }
    if (method === 'DOM.resolveNode') return { object: { objectId: params.backendNodeId === 1 ? 'target' : 'hit' } }
    if (method === 'DOM.getContentQuads') return { quads }
    if (method === 'DOM.getNodeForLocation') return { backendNodeId: hit === target ? 1 : 2 }
    if (method === 'Runtime.callFunctionOn') {
      const fn = dom.window.eval(`(${params.functionDeclaration})`)
      const args = (params.arguments ?? []).map((arg: any) => (arg.objectId ? hit : arg.value))
      return { result: { value: fn.apply(params.objectId === 'target' ? target : hit, args) } }
    }
    if (method === 'Input.insertText') {
      if (!rejectFirstInput) (target as HTMLInputElement).value += params.text
      rejectFirstInput = false
    }
    if (method === 'Input.dispatchKeyEvent') {
      if (params.type === 'rawKeyDown' && params.key === 'Backspace') (target as HTMLInputElement).value = ''
      if (params.type === 'char') (target as HTMLInputElement).value += params.text
    }
    return {}
  })
})
afterEach(() => {
  session.dispose()
  dom.window.close()
  vi.useRealTimers()
})

describe('Browser actions', () => {
  it.each([
    [20, 10, 30, 20, 20, 30, 10, 20],
    [10, 20, 20, 30, 30, 20, 20, 10]
  ])('selects a rotated quad by area regardless of winding: %j', async (...rotatedQuad) => {
    quads = [[0, 0, 12, 0, 12, 12, 0, 12], rotatedQuad]
    expect(await resolveTarget(session, 'e1')).toEqual({ x: 20, y: 20, occluded: false })
  })

  it('rejects targets with only malformed, degenerate or sub-threshold quads', async () => {
    quads = [
      [0, 0, 100, 0, 100, 100],
      [0, 0, 10, 10, 20, 20, 30, 30],
      [0, 0, 1, 0, 1, 1, 0, 1],
      [0, 0, 0.5, 0, 0.5, 0.5, 0, 0.5]
    ]
    await expect(resolveTarget(session, 'e1')).rejects.toThrow('not_found')
  })

  it('accepts a descendant hit and uses the largest quad in CSS pixels', async () => {
    hit = target.firstElementChild!
    expect(await resolveTarget(session, 'e1')).toEqual({ x: 60, y: 30, occluded: false })
    await click(session, 'e1', 'right', 2, {})
    expect(commands.filter((c) => c.method === 'Input.dispatchMouseEvent').map((c) => c.params)).toEqual([
      { type: 'mouseMoved', x: 60, y: 30 },
      { type: 'mousePressed', x: 60, y: 30, button: 'right', clickCount: 1 },
      { type: 'mouseReleased', x: 60, y: 30, button: 'right', clickCount: 1 },
      { type: 'mousePressed', x: 60, y: 30, button: 'right', clickCount: 2 },
      { type: 'mouseReleased', x: 60, y: 30, button: 'right', clickCount: 2 }
    ])
  })

  it('reports a synthetic covered click and never hovers an occluding sibling', async () => {
    hit = dom.window.document.querySelector('input')!
    let clicked = 0
    target.addEventListener('click', () => clicked++)
    expect(await click(session, 'e1', 'left', 1, {})).toEqual({ occluded: true, synthetic: true })
    expect(clicked).toBe(1)
    await expect(hover(session, 'e1', {})).rejects.toThrow('occluded')
    expect(commands.filter((c) => c.method === 'Input.dispatchMouseEvent')).toEqual([])
  })

  it('selects by label and rejects unknown values atomically', async () => {
    target = dom.window.document.querySelector('select')!
    const events: string[] = []
    target.addEventListener('input', () => events.push('input'))
    target.addEventListener('change', () => events.push('change'))
    await selectOption(session, 'e1', ['Beta'], {})
    expect((target as HTMLSelectElement).value).toBe('b')
    expect(events).toEqual(['input', 'change'])
    await expect(selectOption(session, 'e1', ['missing'], {})).rejects.toThrow('not_found')
    expect((target as HTMLSelectElement).value).toBe('b')
    expect(events).toEqual(['input', 'change'])
  })

  it('clears and verifies text, retrying rejected insertion without duplicating the old value', async () => {
    target = dom.window.document.querySelector('input')!
    rejectFirstInput = true
    await typeText(session, 'e1', 'new', true, false, {})
    expect((target as HTMLInputElement).value).toBe('new')
    expect(
      commands
        .filter((c) => c.method === 'Input.dispatchKeyEvent' && c.params.type === 'char')
        .map((c) => c.params.text)
    ).toEqual(['n', 'e', 'w'])
  })

  it('appends to email fields whose selection range API is unavailable', async () => {
    target = dom.window.document.querySelector('input')!
    target.setAttribute('type', 'email')
    ;(target as HTMLInputElement).value = 'user@example'
    await typeText(session, 'e1', '.com', false, false, {})
    expect((target as HTMLInputElement).value).toBe('user@example.com')
  })

  it('never retries rejected line breaks as form-submit key presses', async () => {
    target = dom.window.document.querySelector('input')!
    rejectFirstInput = true
    await expect(typeText(session, 'e1', 'a\nb', true, false, {})).rejects.toThrow('not_found')
    expect(commands.filter((c) => c.method === 'Input.dispatchKeyEvent' && c.params.key === 'Enter')).toEqual([])
  })

  it('maps chords to virtual keys and emits one Enter character', async () => {
    await pressKey(session, 'Control+a', {})
    await pressKey(session, 'Enter', {})
    const keys = commands.filter((c) => c.method === 'Input.dispatchKeyEvent').map((c) => c.params)
    expect(keys[0]).toMatchObject({ key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 })
    expect(keys.filter((k) => k.type === 'char')).toEqual([expect.objectContaining({ key: 'Enter', text: '\r' })])
    await expect(pressKey(session, 'Bogus+a', {})).rejects.toThrow('not_allowed')
  })

  it.each([
    ['Shift+a', 'A', 'KeyA', 65],
    ['Shift+1', '!', 'Digit1', 49],
    ['Shift+/', '?', 'Slash', 191],
    ['+', '+', 'Equal', 187],
    [' ', ' ', 'Space', 32]
  ])('maps %s to its physical key and resulting text', async (chord, key, code, windowsVirtualKeyCode) => {
    await pressKey(session, chord, {})
    const events = commands.filter((c) => c.method === 'Input.dispatchKeyEvent').map((c) => c.params)
    expect(events.map((event) => event.type)).toEqual(['rawKeyDown', 'char', 'keyUp'])
    for (const event of events) expect(event).toMatchObject({ key, code, windowsVirtualKeyCode })
    expect(events[1].text).toBe(key)
  })

  it('supports plus-key shortcuts without inserting text', async () => {
    await pressKey(session, 'Control++', {})
    const events = commands.filter((c) => c.method === 'Input.dispatchKeyEvent').map((c) => c.params)
    expect(events.map((event) => event.type)).toEqual(['rawKeyDown', 'keyUp'])
    expect(events[0]).toMatchObject({ key: '+', code: 'Equal', windowsVirtualKeyCode: 187, modifiers: 2 })
  })

  it('holds the operation until navigation loads and interrupts the wait for a dialog', async () => {
    vi.useFakeTimers()
    let finished = false
    const action = settleAction(session, async () => {
      mock.debugger.emit('message', {}, 'Page.frameStartedLoading', { frameId: 'main' })
      mock.debugger.emit('message', {}, 'Page.frameNavigated', { frame: { id: 'main', loaderId: 'next-document' } })
    }).then((result) => {
      finished = true
      return result
    })
    await vi.advanceTimersByTimeAsync(1000)
    expect(finished).toBe(false)
    mock.debugger.emit('message', {}, 'Page.loadEventFired', {})
    await vi.advanceTimersByTimeAsync(50)
    expect((await action).navigated).toBe(true)
    const blocked = settleAction(session, async () => undefined)
    const assertion = expect(blocked).rejects.toThrow('dialog_open')
    await vi.advanceTimersByTimeAsync(1)
    mock.debugger.emit('message', {}, 'Page.javascriptDialogOpening', { type: 'alert', message: 'Page data' })
    await assertion
  })

  it('waits for tracked fetches to finish, then 300 ms of quiet', async () => {
    vi.useFakeTimers()
    let finished = false
    const action = settleAction(session, async () => {
      mock.debugger.emit('message', {}, 'Network.requestWillBeSent', { requestId: 'fetch', type: 'Fetch' })
    }).then(() => {
      finished = true
    })
    await vi.advanceTimersByTimeAsync(800)
    expect(finished).toBe(false)
    mock.debugger.emit('message', {}, 'Network.loadingFinished', { requestId: 'fetch' })
    await vi.advanceTimersByTimeAsync(299)
    expect(finished).toBe(false)
    await vi.advanceTimersByTimeAsync(51)
    await action
    expect(finished).toBe(true)
  })
})
