import { JSDOM } from 'jsdom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import * as platform from '@main/core/platform'

import { selectOption } from '../actions/forms'
import { pressKey, typeText } from '../actions/keyboard'
import { click, hover } from '../actions/mouse'
import { resolveTarget } from '../actions/resolveTarget'
import { settleAction } from '../actions/settle'
import type { BrowserActionOptions } from '../BrowserCursor'
import type { BrowserGuestTarget } from '../BrowserGuestRegistry'
import type { BrowserSessionService } from '../BrowserSessionService'
import { SessionBrowserController } from '../mcp/SessionBrowserController'
import { BrowserSessionError } from '../session/BrowserSessionError'
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
let guestFocused: boolean
let hostDom: JSDOM
let host: HTMLTextAreaElement
let focusTarget: HTMLElement | undefined
let borrowedOptions: BrowserActionOptions
let sendInputEvent: ReturnType<typeof vi.fn<(event: Electron.KeyboardInputEvent) => void>>
let afterInput: (event: Electron.KeyboardInputEvent) => void
let controller: SessionBrowserController | undefined
let afterCommand: (method: string, params: any) => void
const inputCommands = () => commands.filter(({ method }) => method.startsWith('Input.'))
const focusInput = async () => {
  guestFocused = true
}
async function borrowGuest() {
  session.dispose()
  session = new GuestSession(mock as unknown as Electron.WebContents, 'borrowed')
  vi.spyOn(session, 'resolveRef').mockReturnValue(1)
  target = dom.window.document.querySelector('input')!
  const bindingTarget = {
    tabId: 'borrowed',
    guest: session.guest,
    abort: new AbortController(),
    beginExecution: () => ({ dispose() {} }),
    cursor: { hide() {} }
  } as BrowserGuestTarget
  controller = new SessionBrowserController(
    { acquire: async () => session, release() {} } as unknown as BrowserSessionService,
    {
      assertAvailable() {},
      get: () => bindingTarget,
      ensureGuest: async () => bindingTarget,
      focusInput,
      reveal() {}
    }
  )
  const { focusInput: request, ...routing } = await controller.getSession()
  borrowedOptions = { focusInput: request, ...routing }
  commands = []
}

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
  guestFocused = true
  hostDom = new JSDOM(
    '<textarea id=host></textarea><div inert><webview id=view style="width:0;height:0"></webview></div>'
  )
  host = hostDom.window.document.querySelector('textarea')!
  host.focus()
  focusTarget = undefined
  afterInput = () => {}
  host.value = 'host draft'
  afterCommand = () => {}
  vi.spyOn(dom.window.document, 'hasFocus').mockImplementation(() => guestFocused)
  Object.defineProperty(dom.window.HTMLElement.prototype, 'isContentEditable', {
    get() {
      return this.closest('[contenteditable]')?.getAttribute('contenteditable') === 'true'
    }
  })
  const selected = new WeakSet<Element>()
  sendInputEvent = vi.fn((event: Electron.KeyboardInputEvent) => {
    let active = dom.window.document.activeElement
    while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement
    const recipient = active as HTMLInputElement
    if (event.type === 'keyDown' && event.keyCode === 'Enter' && recipient.tagName === 'INPUT')
      recipient.form?.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }))
    if (event.type === 'keyDown' && event.keyCode === 'Backspace') {
      if ('value' in recipient) {
        const start = recipient.selectionStart ?? recipient.value.length
        const end = recipient.selectionEnd ?? start
        recipient.value =
          recipient.value.slice(0, start === end ? Math.max(0, start - 1) : start) + recipient.value.slice(end)
      } else {
        const selection = dom.window.getSelection()!
        if (selection.rangeCount) selection.getRangeAt(0).deleteContents()
      }
    }
    if (event.type === 'char') {
      if (!rejectFirstInput) {
        const text = event.keyCode === '\r' ? (recipient.tagName === 'TEXTAREA' ? '\n' : '') : event.keyCode
        if ('value' in recipient) recipient.value += text
        else (recipient as Element).textContent = ((recipient as Element).textContent ?? '') + text
      }
      rejectFirstInput = false
    }
    afterInput(event)
  })
  Object.assign(mock, { sendInputEvent })
  mock.debugger.sendCommand.mockImplementation(async (method, params: any = {}) => {
    commands.push({ method, params })
    if (method === 'Page.getFrameTree') return { frameTree: { frame: { id: 'main', loaderId: 'doc' } } }
    if (method === 'DOM.resolveNode') return { object: { objectId: params.backendNodeId === 1 ? 'target' : 'hit' } }
    if (method === 'DOM.getContentQuads') return { quads }
    if (method === 'Page.getLayoutMetrics') return { cssLayoutViewport: { pageX: 0, pageY: 0 } }
    if (method === 'DOM.getNodeForLocation') return { backendNodeId: hit === target ? 1 : 2 }
    if (method === 'Runtime.evaluate') return { result: { value: dom.window.eval(params.expression) } }
    if (method === 'DOM.focus') {
      ;(focusTarget ?? (target as HTMLElement)).focus()
    }
    if (method === 'Runtime.callFunctionOn') {
      const fn = dom.window.eval(`(${params.functionDeclaration})`)
      const args = (params.arguments ?? []).map((arg: any) => (arg.objectId ? hit : arg.value))
      const value = fn.apply(params.objectId === 'target' ? target : hit, args)
      afterCommand(method, params)
      return { result: { value } }
    }
    let active = dom.window.document.activeElement
    while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement
    const recipient = (guestFocused ? active : host) as HTMLInputElement
    const readValue = () => recipient.value ?? recipient.textContent ?? ''
    const writeValue = (value: string) => {
      if ('value' in recipient) recipient.value = value
      else (recipient as Element).textContent = value
    }
    if (method === 'Input.insertText') {
      if (!rejectFirstInput) writeValue(readValue() + params.text)
      rejectFirstInput = false
    }
    if (method === 'Input.dispatchKeyEvent') {
      if (params.type === 'rawKeyDown' && params.commands?.includes('selectAll')) selected.add(recipient)
      if (params.type === 'rawKeyDown' && params.key === 'Backspace' && selected.has(recipient)) {
        writeValue('')
        selected.delete(recipient)
      }
      if (params.type === 'char' && params.key !== 'Enter') writeValue(readValue() + params.text)
    }
    afterCommand(method, params)
    return {}
  })
})
afterEach(async () => {
  await controller?.dispose()
  controller = undefined
  session.dispose()
  hostDom.window.close()
  dom.window.close()
  vi.useRealTimers()
})

describe('Browser actions', () => {
  it('waits for visual arrival and clicks the target at its updated position', async () => {
    let arrive!: () => void
    const arrival = new Promise<boolean>((resolve) => {
      arrive = () => resolve(true)
    })
    let started!: () => void
    const moving = new Promise<void>((resolve) => {
      started = resolve
    })
    const pointer = {
      move: () => {
        started()
        return arrival
      },
      update: vi.fn(),
      pressed: vi.fn(),
      hide: vi.fn()
    }
    const result = click(session, 'e1', 'left', 1, { pointer })
    await moving
    expect(commands.filter((command) => command.method === 'Input.dispatchMouseEvent')).toEqual([])
    quads = [[100, 100, 200, 100, 200, 140, 100, 140]]
    arrive()
    expect(await result).toEqual({ occluded: false, synthetic: false })
    expect(
      commands
        .filter((command) => command.method === 'Input.dispatchMouseEvent')
        .map(({ params }) => [params.type, params.x, params.y])
    ).toEqual([
      ['mouseMoved', 150, 120],
      ['mousePressed', 150, 120],
      ['mouseReleased', 150, 120]
    ])
  })

  it('does not send mouse input when the action is cancelled during animation', async () => {
    const abort = new AbortController()
    const pointer = {
      move: async () => {
        abort.abort(new Error('cancelled'))
        return true
      },
      update: vi.fn(),
      pressed: vi.fn(),
      hide: vi.fn()
    }
    await expect(click(session, 'e1', 'left', 1, { pointer, signal: abort.signal })).rejects.toThrow('cancelled')
    expect(commands.filter((command) => command.method === 'Input.dispatchMouseEvent')).toEqual([])
  })

  it('does not press a target that moved as a result of real hover', async () => {
    const fallback = mock.debugger.sendCommand.getMockImplementation()!
    mock.debugger.sendCommand.mockImplementation(async (method, params: any) => {
      const result = await fallback(method, params)
      if (method === 'Input.dispatchMouseEvent' && params.type === 'mouseMoved') {
        quads = [[200, 200, 300, 200, 300, 240, 200, 240]]
      }
      return result
    })
    const pointer = { move: async () => true, update: vi.fn(), pressed: vi.fn(), hide: vi.fn() }
    await expect(click(session, 'e1', 'left', 1, { pointer })).rejects.toMatchObject({ code: 'occluded' })
    expect(
      commands.filter((command) => command.method === 'Input.dispatchMouseEvent').map(({ params }) => params.type)
    ).toEqual(['mouseMoved'])
  })

  it('hit-tests scrolled documents in page coordinates while keeping mouse input in viewport coordinates', async () => {
    const fallback = mock.debugger.sendCommand.getMockImplementation()!
    mock.debugger.sendCommand.mockImplementation(async (method, params: any) => {
      if (method === 'Page.getLayoutMetrics') return { cssLayoutViewport: { pageX: 1000, pageY: 2000 } }
      if (method === 'DOM.getNodeForLocation' && (params.x !== 1060 || params.y !== 2030))
        throw new Error('No node found at given location')
      return fallback(method, params)
    })
    expect(await click(session, 'e1', 'left', 1, {})).toEqual({ occluded: false, synthetic: false })
    expect(
      commands
        .filter((command) => command.method === 'Input.dispatchMouseEvent')
        .map((command) => [command.params.x, command.params.y])
    ).toEqual([
      [60, 30],
      [60, 30],
      [60, 30]
    ])
  })
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

  describe('borrowed keyboard routing', () => {
    beforeEach(borrowGuest)

    it.each(['Cherry Studio', '中文输入', 'café', 'A🙂e\u0301B'])(
      'appends %s through complete guest key sequences',
      async (text) => {
        await typeText(session, 'e1', text, false, false, borrowedOptions)
        expect((target as HTMLInputElement).value).toBe(`old${text}`)
        expect(host.value).toBe('host draft')
        expect(inputCommands()).toEqual([])
        expect(sendInputEvent.mock.calls.map(([event]) => [event.type, event.keyCode])).toEqual(
          [...text].flatMap((character) => [
            ['keyDown', character],
            ['char', character],
            ['keyUp', character]
          ])
        )
      }
    )

    it.each([
      [false, '\n'],
      [true, '\n'],
      [false, '\r'],
      [true, '\r'],
      [false, '\r\n'],
      [true, '\r\n']
    ] as const)('rejects multiline input before mutation (clear=%s, newline=%j)', async (clear, newline) => {
      const form = dom.window.document.createElement('form')
      form.innerHTML = '<button type="submit">Submit</button>'
      form.prepend(target)
      dom.window.document.body.append(form)
      const submissions: string[] = []
      form.addEventListener('submit', (event) => {
        event.preventDefault()
        submissions.push((target as HTMLInputElement).value)
      })
      const url = dom.window.location.href
      await expect(
        typeText(session, 'e1', `hello${newline}world`, clear, false, borrowedOptions)
      ).rejects.toMatchObject({
        code: 'not_found'
      })
      expect((target as HTMLInputElement).value).toBe('old')
      expect(submissions).toEqual([])
      expect(dom.window.location.href).toBe(url)
      expect(sendInputEvent.mock.calls).toEqual([])
      expect(host.value).toBe('host draft')
      expect(inputCommands()).toEqual([])
    })

    it('inserts a textarea newline as a character without an Enter command', async () => {
      target = dom.window.document.createElement('textarea')
      ;(target as HTMLTextAreaElement).value = 'old'
      dom.window.document.body.append(target)
      const submissions: Event[] = []
      dom.window.document.addEventListener('submit', (event) => submissions.push(event))
      await typeText(session, 'e1', 'a\nb', true, false, borrowedOptions)
      expect((target as HTMLTextAreaElement).value).toBe('a\nb')
      expect(submissions).toEqual([])
      expect(host.value).toBe('host draft')
      expect(inputCommands()).toEqual([])
      expect(sendInputEvent.mock.calls.map(([event]) => [event.type, event.keyCode])).toEqual([
        ['keyDown', 'Backspace'],
        ['keyUp', 'Backspace'],
        ['keyDown', 'a'],
        ['char', 'a'],
        ['keyUp', 'a'],
        ['char', '\r'],
        ['keyDown', 'b'],
        ['char', 'b'],
        ['keyUp', 'b']
      ])
    })

    it.each([
      ['email', 'old@example.com', 'new@example.com'],
      ['number', '123', '456']
    ])('replaces a borrowed %s value and notifies page listeners', async (kind, oldValue, newValue) => {
      const field = target as HTMLInputElement
      field.type = kind
      field.value = oldValue
      const changes: Array<{ type: string; bubbles: boolean; value: string }> = []
      for (const type of ['input', 'change'])
        dom.window.document.addEventListener(type, (event) => {
          if (event.target === field) changes.push({ type: event.type, bubbles: event.bubbles, value: field.value })
        })
      expect(field.selectionStart).toBeNull()
      await typeText(session, 'e1', newValue, true, false, borrowedOptions)
      expect(field.value).toBe(newValue)
      expect(changes).toEqual([
        { type: 'input', bubbles: true, value: '' },
        { type: 'change', bubbles: true, value: '' }
      ])
      expect(sendInputEvent.mock.calls.map(([event]) => [event.type, event.keyCode])).toEqual(
        [...newValue].flatMap((character) => [
          ['keyDown', character],
          ['char', character],
          ['keyUp', character]
        ])
      )
      expect(host.value).toBe('host draft')
      expect(inputCommands()).toEqual([])
    })

    it.each([
      [true, 'Meta+a'],
      [false, 'Control+a']
    ] as const)('selects borrowed field contents on isMac=%s with %s', async (isMac, chord) => {
      const platformSpy = vi.spyOn(platform, 'isMac', 'get').mockReturnValue(isMac)
      try {
        const field = target as HTMLInputElement
        field.focus()
        await pressKey(session, chord, borrowedOptions)
        expect([field.selectionStart, field.selectionEnd]).toEqual([0, 3])
        expect(sendInputEvent.mock.calls.map(([event]) => event)).toEqual([
          { type: 'keyDown', keyCode: 'a', modifiers: [isMac ? 'meta' : 'control'] },
          { type: 'keyUp', keyCode: 'a', modifiers: [isMac ? 'meta' : 'control'] }
        ])
        await pressKey(session, 'Backspace', borrowedOptions)
        expect(field.value).toBe('')
        expect(host.value).toBe('host draft')
        expect(hostDom.window.document.activeElement).toBe(host)
        expect(inputCommands()).toEqual([])
      } finally {
        platformSpy.mockRestore()
      }
    })

    it.each(['Bogus+a', 'Control+Nope'])('rejects invalid chord %s before requesting focus', async (chord) => {
      guestFocused = false
      const acknowledge = vi.fn()
      await expect(pressKey(session, chord, { ...borrowedOptions, focusInput: acknowledge })).rejects.toMatchObject({
        code: 'not_allowed'
      })
      expect(acknowledge).not.toHaveBeenCalled()
      expect(guestFocused).toBe(false)
      expect(inputCommands()).toEqual([])
      expect(sendInputEvent).not.toHaveBeenCalled()
      expect(host.value).toBe('host draft')
    })

    it('rejects an invalid chord before requiring a focus callback', async () => {
      await expect(pressKey(session, 'Bogus+a', {})).rejects.toMatchObject({ code: 'not_allowed' })
    })

    it('requests focus once and types a valid chord into the page', async () => {
      guestFocused = false
      ;(target as HTMLInputElement).focus()
      const acknowledge = vi.fn(borrowedOptions.focusInput)
      await pressKey(session, 'x', { ...borrowedOptions, focusInput: acknowledge })
      expect(acknowledge).toHaveBeenCalledTimes(1)
      expect((target as HTMLInputElement).value).toBe('oldx')
      expect(host.value).toBe('host draft')
      expect(inputCommands()).toEqual([])
    })

    it.each(['type', 'key'])('refuses %s without a focus callback before dispatch', async (action) => {
      await expect(
        action === 'type' ? typeText(session, 'e1', 'new', true, true, {}) : pressKey(session, 'x', {})
      ).rejects.toMatchObject({ code: 'input_unavailable' })
      expect((target as HTMLInputElement).value).toBe('old')
      expect(host.value).toBe('host draft')
      expect(inputCommands()).toEqual([])
      expect(sendInputEvent).not.toHaveBeenCalled()
    })

    it.each(['type', 'key'])(
      'delivers %s in the leak state with an inert pane and a focused host composer',
      async (action) => {
        guestFocused = false
        ;(target as HTMLInputElement).focus()
        const options = { ...borrowedOptions, focusInput: async () => {} }
        expect(dom.window.document.hasFocus()).toBe(false)
        expect(hostDom.window.document.querySelector('webview')?.closest('[inert]')).not.toBeNull()
        expect(hostDom.window.document.activeElement).toBe(host)
        if (action === 'type')
          await typeText(session, 'e1', 'Cherry Studio 中文 café A🙂e\u0301B', true, false, options)
        else await pressKey(session, 'X', options)
        expect((target as HTMLInputElement).value).toBe(
          action === 'type' ? 'Cherry Studio 中文 café A🙂e\u0301B' : 'oldX'
        )
        expect(host.value).toBe('host draft')
        expect(hostDom.window.document.activeElement).toBe(host)
        expect(inputCommands()).toEqual([])
        const text = action === 'type' ? 'Cherry Studio 中文 café A🙂e\u0301B' : 'X'
        expect(sendInputEvent.mock.calls.map(([event]) => [event.type, event.keyCode])).toEqual([
          ...(action === 'type'
            ? [
                ['keyDown', 'Backspace'],
                ['keyUp', 'Backspace']
              ]
            : []),
          ...[...text].flatMap((character) => [
            ['keyDown', character],
            ['char', character],
            ['keyUp', character]
          ])
        ])
      }
    )

    it.each(['Enter', 'Control+a', 'Meta+a', 'Control++', 'Equal'])(
      'routes borrowed chord %s without CDP Input',
      async (chord) => {
        ;(target as HTMLInputElement).focus()
        await pressKey(session, chord, borrowedOptions)
        const expected: Record<string, Electron.KeyboardInputEvent[]> = {
          Enter: [
            { type: 'keyDown', keyCode: 'Enter', modifiers: [] },
            { type: 'char', keyCode: '\r', modifiers: [] },
            { type: 'keyUp', keyCode: 'Enter', modifiers: [] }
          ],
          'Control+a': [
            { type: 'keyDown', keyCode: 'a', modifiers: ['control'] },
            { type: 'keyUp', keyCode: 'a', modifiers: ['control'] }
          ],
          'Meta+a': [
            { type: 'keyDown', keyCode: 'a', modifiers: ['meta'] },
            { type: 'keyUp', keyCode: 'a', modifiers: ['meta'] }
          ],
          'Control++': [
            { type: 'keyDown', keyCode: '+', modifiers: ['control'] },
            { type: 'keyUp', keyCode: '+', modifiers: ['control'] }
          ],
          Equal: [
            { type: 'keyDown', keyCode: '=', modifiers: [] },
            { type: 'char', keyCode: '=', modifiers: [] },
            { type: 'keyUp', keyCode: '=', modifiers: [] }
          ]
        }
        expect(sendInputEvent.mock.calls.map(([event]) => event)).toEqual(expected[chord])
        expect(inputCommands()).toEqual([])
        expect(host.value).toBe('host draft')
      }
    )

    it('stops when target focus is lost before the initial clear', async () => {
      const other = dom.window.document.createElement('input')
      other.value = 'other field'
      dom.window.document.body.append(other)
      afterCommand = (method) => {
        if (method === 'DOM.focus') other.focus()
      }
      await expect(typeText(session, 'e1', 'new', true, true, borrowedOptions)).rejects.toMatchObject({
        code: 'input_not_focused'
      })
      expect((target as HTMLInputElement).value).toBe('old')
      expect(other.value).toBe('other field')
      expect(host.value).toBe('host draft')
      expect(inputCommands()).toEqual([])
      expect(sendInputEvent).not.toHaveBeenCalled()
    })

    it.each(['input', 'textarea', 'contenteditable'])(
      'replaces a borrowed %s using page selection and Backspace without CDP Input',
      async (kind) => {
        if (kind !== 'input') {
          target = dom.window.document.createElement(kind === 'textarea' ? 'textarea' : 'div')
          if (kind === 'contenteditable') {
            target.setAttribute('contenteditable', 'true')
            ;(target as HTMLElement).tabIndex = 0
            target.innerHTML = '<span>old</span><b> contents</b>'
          } else (target as HTMLTextAreaElement).value = 'old contents'
          dom.window.document.body.append(target)
        }
        await typeText(session, 'e1', 'new', true, false, borrowedOptions)
        expect((target as HTMLInputElement).value ?? target.textContent).toBe('new')
        expect(host.value).toBe('host draft')
        expect(inputCommands()).toEqual([])
        expect(sendInputEvent.mock.calls.map(([event]) => [event.type, event.keyCode])).toEqual([
          ['keyDown', 'Backspace'],
          ['keyUp', 'Backspace'],
          ['keyDown', 'n'],
          ['char', 'n'],
          ['keyUp', 'n'],
          ['keyDown', 'e'],
          ['char', 'e'],
          ['keyUp', 'e'],
          ['keyDown', 'w'],
          ['char', 'w'],
          ['keyUp', 'w']
        ])
      }
    )

    it('rechecks target focus after page selection before Backspace', async () => {
      afterCommand = (method, params) => {
        if (method === 'Runtime.callFunctionOn' && params.functionDeclaration.includes('this.setSelectionRange'))
          (target as HTMLElement).blur()
      }
      await expect(typeText(session, 'e1', 'new', true, true, borrowedOptions)).rejects.toMatchObject({
        code: 'input_not_focused'
      })
      expect((target as HTMLInputElement).value).toBe('old')
      expect(host.value).toBe('host draft')
      expect(sendInputEvent.mock.calls).toEqual([])
      expect(inputCommands()).toEqual([])
    })

    it('does not replay or submit after an ignored insertion loses target focus', async () => {
      rejectFirstInput = true
      afterInput = (event) => {
        if (event.type === 'char') (target as HTMLElement).blur()
      }
      await expect(typeText(session, 'e1', 'n', false, true, borrowedOptions)).rejects.toMatchObject({
        code: 'input_not_focused'
      })
      expect((target as HTMLInputElement).value).toBe('old')
      expect(host.value).toBe('host draft')
      expect(sendInputEvent.mock.calls.map(([event]) => event)).toEqual([
        { type: 'keyDown', keyCode: 'n', modifiers: [] },
        { type: 'char', keyCode: 'n', modifiers: [] }
      ])
      expect(inputCommands()).toEqual([])
    })

    it('suppresses char, keyUp and submit after key-down loses the target', async () => {
      ;(target as HTMLInputElement).focus()
      afterInput = (event) => {
        if (event.type === 'keyDown') (target as HTMLElement).blur()
      }
      await expect(
        pressKey(session, 'x', {
          ...borrowedOptions,
          assertInputTarget: (_objectId, options) => borrowedOptions.assertInputTarget!('target', options)
        })
      ).rejects.toMatchObject({ code: 'input_not_focused' })
      expect((target as HTMLInputElement).value).toBe('old')
      expect(host.value).toBe('host draft')
      expect(sendInputEvent.mock.calls.map(([event]) => event.type)).toEqual(['keyDown'])
      expect(inputCommands()).toEqual([])
    })

    it('stops before submit after successful insertion loses target focus', async () => {
      afterInput = (event) => {
        if (event.type === 'char' && event.keyCode === 'w') (target as HTMLElement).blur()
      }
      await expect(typeText(session, 'e1', 'new', true, true, borrowedOptions)).rejects.toMatchObject({
        code: 'input_not_focused'
      })
      expect((target as HTMLInputElement).value).toBe('new')
      expect(host.value).toBe('host draft')
      expect(sendInputEvent.mock.calls.map(([event]) => [event.type, event.keyCode])).toEqual([
        ['keyDown', 'Backspace'],
        ['keyUp', 'Backspace'],
        ['keyDown', 'n'],
        ['char', 'n'],
        ['keyUp', 'n'],
        ['keyDown', 'e'],
        ['char', 'e'],
        ['keyUp', 'e'],
        ['keyDown', 'w'],
        ['char', 'w']
      ])
      expect(inputCommands()).toEqual([])
    })

    it('replays the complete appended Unicode value once through the guest route', async () => {
      rejectFirstInput = true
      const acknowledge = vi.fn(borrowedOptions.focusInput)
      await typeText(session, 'e1', '中文🙂e\u0301', false, true, { ...borrowedOptions, focusInput: acknowledge })
      expect((target as HTMLInputElement).value).toBe('old中文🙂e\u0301')
      expect(host.value).toBe('host draft')
      expect(acknowledge).toHaveBeenCalledTimes(1)
      expect(inputCommands()).toEqual([])
      expect(sendInputEvent.mock.calls.map(([event]) => [event.type, event.keyCode])).toEqual([
        ...[...'中文🙂e\u0301'].flatMap((character) => [
          ['keyDown', character],
          ['char', character],
          ['keyUp', character]
        ]),
        ['keyDown', 'Backspace'],
        ['keyUp', 'Backspace'],
        ...[...'old中文🙂e\u0301'].flatMap((character) => [
          ['keyDown', character],
          ['char', character],
          ['keyUp', character]
        ]),
        ['keyDown', 'Enter'],
        ['char', '\r'],
        ['keyUp', 'Enter']
      ])
    })

    it('types into a focused shadow-root input without touching the host', async () => {
      const container = dom.window.document.createElement('div')
      dom.window.document.body.append(container)
      const root = container.attachShadow({ mode: 'open' })
      root.innerHTML = '<input value="shadow">'
      target = root.querySelector('input')!
      await typeText(session, 'e1', 'new', true, false, borrowedOptions)
      expect((target as HTMLInputElement).value).toBe('new')
      expect(dom.window.document.activeElement).toBe(container)
      expect(root.activeElement).toBe(target)
      expect(host.value).toBe('host draft')
      expect(inputCommands()).toEqual([])
      expect(sendInputEvent.mock.calls.map(([event]) => [event.type, event.keyCode])).toEqual([
        ['keyDown', 'Backspace'],
        ['keyUp', 'Backspace'],
        ...[...'new'].flatMap((character) => [
          ['keyDown', character],
          ['char', character],
          ['keyUp', character]
        ])
      ])
    })

    it('accepts an editable descendant whose editing host owns focus', async () => {
      const editor = dom.window.document.createElement('div')
      editor.setAttribute('contenteditable', 'true')
      editor.tabIndex = 0
      editor.innerHTML = '<span>old</span>'
      dom.window.document.body.append(editor)
      target = editor.firstElementChild!
      focusTarget = editor
      await typeText(session, 'e1', '', false, false, borrowedOptions)
      expect(dom.window.document.activeElement).toBe(editor)
      expect(editor.textContent).toBe('old')
      expect(host.value).toBe('host draft')
      expect(inputCommands()).toEqual([])
      expect(sendInputEvent.mock.calls).toEqual([])
    })

    it.each(['cancel', 'stale', 'timeout'])(
      'preserves %s detected after an awaited routing assertion',
      async (failure) => {
        const abort = new AbortController()
        const options = { ...borrowedOptions, signal: abort.signal, deadline: Date.now() + 30_000 }
        afterCommand = (method, params) => {
          if (method !== 'Runtime.callFunctionOn' || !params.functionDeclaration.includes('active === target')) return
          if (failure === 'cancel') abort.abort(new Error('cancelled'))
          if (failure === 'stale') vi.spyOn(session, 'resolveRef').mockReturnValue(2)
          if (failure === 'timeout') options.deadline = Date.now() - 1
        }
        const action = typeText(session, 'e1', 'new', true, true, options)
        if (failure === 'cancel') await expect(action).rejects.toThrow('cancelled')
        else await expect(action).rejects.toMatchObject({ code: failure === 'stale' ? 'stale_ref' : 'timeout' })
        expect((target as HTMLInputElement).value).toBe('old')
        expect(host.value).toBe('host draft')
        expect(inputCommands()).toEqual([])
        expect(sendInputEvent).not.toHaveBeenCalled()
      }
    )

    it('skips Enter release after submission invalidates the original ref', async () => {
      afterInput = (event) => {
        if (event.type === 'char' && event.keyCode === '\r')
          vi.spyOn(session, 'resolveRef').mockImplementation(() => {
            throw new BrowserSessionError('stale_ref')
          })
      }
      await typeText(session, 'e1', 'new', true, true, borrowedOptions)
      expect((target as HTMLInputElement).value).toBe('new')
      expect(host.value).toBe('host draft')
      expect(sendInputEvent.mock.calls.map(([event]) => [event.type, event.keyCode])).toEqual([
        ['keyDown', 'Backspace'],
        ['keyUp', 'Backspace'],
        ...[...'new'].flatMap((character) => [
          ['keyDown', character],
          ['char', character],
          ['keyUp', character]
        ]),
        ['keyDown', 'Enter'],
        ['char', '\r']
      ])
      expect(inputCommands()).toEqual([])
    })

    it('routes standalone keys after host focus changes without requiring an editable target', async () => {
      ;(target as HTMLInputElement).focus()
      afterInput = () => {
        guestFocused = false
      }
      await pressKey(session, 'Tab', borrowedOptions)
      await pressKey(session, 'x', { ...borrowedOptions, focusInput: async () => {} })
      expect((target as HTMLInputElement).value).toBe('oldx')
      expect(host.value).toBe('host draft')
      expect(inputCommands()).toEqual([])
    })
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
      mock.debugger.emit('message', {}, 'Network.requestWillBeSent', {
        requestId: 'fetch',
        type: 'Fetch',
        request: { method: 'GET', url: 'https://example.com/data' }
      })
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
