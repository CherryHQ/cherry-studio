// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { WEBVIEW_ANNOTATION_BRIDGE_CHANNEL, type WebviewAnnotationHostCommand } from '@shared/types/webviewAnnotation'
import { WEBVIEW_KEYDOWN_CHANNEL } from '@shared/utils/webviewKey'

const { executeJavaScriptInIsolatedWorld, sendToHost } = vi.hoisted(() => ({
  executeJavaScriptInIsolatedWorld: vi.fn().mockReturnValue(Promise.resolve()),
  sendToHost: vi.fn()
}))
const ipcListeners = new Map<string, (event: unknown, value: unknown) => void>()

vi.mock('electron', () => ({
  ipcRenderer: {
    on: (channel: string, listener: (event: unknown, value: unknown) => void) => ipcListeners.set(channel, listener),
    sendToHost
  },
  webFrame: {
    executeJavaScriptInIsolatedWorld
  }
}))

const sessionId = '00000000-0000-4000-8000-000000000001'

const trustedKey = (key: string, options: { ctrlKey?: boolean; isComposing?: boolean } = {}) =>
  ({
    altKey: false,
    code: key === 'Escape' ? 'Escape' : `Key${key.toUpperCase()}`,
    composedPath: () => [document, window],
    ctrlKey: options.ctrlKey ?? false,
    isComposing: options.isComposing ?? false,
    isTrusted: true,
    key,
    metaKey: false,
    preventDefault: vi.fn(),
    repeat: false,
    shiftKey: false,
    stopImmediatePropagation: vi.fn(),
    target: document
  }) as unknown as KeyboardEvent

describe('combined webview preload keyboard relay', () => {
  let inputListeners: Map<string, (event: Event) => void>
  let keydown: (event: KeyboardEvent) => void
  let unload: (() => void) | undefined
  let addEventListener: ReturnType<typeof vi.spyOn>

  beforeEach(async () => {
    vi.resetModules()
    sendToHost.mockClear()
    ipcListeners.clear()
    inputListeners = new Map()
    const keydownListeners: Array<(event: KeyboardEvent) => void> = []
    addEventListener = vi.spyOn(window, 'addEventListener').mockImplementation((type, listener) => {
      if (type === 'keydown') keydownListeners.push(listener as (event: KeyboardEvent) => void)
      if (['click', 'pointerdown', 'pointermove', 'pointerup'].includes(type)) {
        inputListeners.set(type, listener as (event: Event) => void)
      }
      if (type === 'unload') unload = listener as () => void
    })

    await import('../webview')
    expect(keydownListeners).toHaveLength(1)
    keydown = keydownListeners[0]
  })

  afterEach(() => {
    unload?.()
    addEventListener.mockRestore()
    document.body.replaceChildren()
    vi.restoreAllMocks()
  })

  const sendCommand = (command: WebviewAnnotationHostCommand) => {
    ipcListeners.get(WEBVIEW_ANNOTATION_BRIDGE_CHANNEL)?.(undefined, command)
  }

  const enableAnnotations = () => {
    sendCommand({ type: 'start_session', sessionId })
    sendCommand({ type: 'configure', sessionId, locale: { edit: 'Edit' }, theme: 'light' })
    sendCommand({ type: 'set_enabled', sessionId, enabled: true })
    sendToHost.mockClear()
  }

  it('relays Escape while annotations are inactive', () => {
    const event = trustedKey('Escape')

    keydown(event)

    expect(sendToHost).toHaveBeenCalledWith(
      WEBVIEW_KEYDOWN_CHANNEL,
      expect.objectContaining({ key: 'Escape', isTrusted: true })
    )
  })

  it('lets annotations own Escape without relaying it to the host', () => {
    enableAnnotations()
    const event = trustedKey('Escape')

    keydown(event)

    expect(event.preventDefault).toHaveBeenCalledOnce()
    expect(event.stopImmediatePropagation).toHaveBeenCalledOnce()
    expect(sendToHost).not.toHaveBeenCalledWith(WEBVIEW_KEYDOWN_CHANNEL, expect.anything())
  })

  it('still relays non-Escape host shortcuts while annotations are active', () => {
    enableAnnotations()
    const event = trustedKey('f', { ctrlKey: true })

    keydown(event)

    expect(event.preventDefault).toHaveBeenCalledOnce()
    expect(sendToHost).toHaveBeenCalledWith(
      WEBVIEW_KEYDOWN_CHANNEL,
      expect.objectContaining({ key: 'f', ctrlKey: true })
    )
  })

  it('closes the annotation editor on Escape without relaying or disabling selection', () => {
    enableAnnotations()
    const target = document.createElement('button')
    target.id = 'editor-target'
    document.body.appendChild(target)
    inputListeners.get('click')?.({
      composedPath: () => [target, document.body, document.documentElement, document, window],
      isTrusted: true,
      preventDefault: vi.fn(),
      stopImmediatePropagation: vi.fn(),
      target
    } as unknown as MouseEvent)
    sendToHost.mockClear()

    keydown(trustedKey('Escape'))

    expect(sendToHost).toHaveBeenCalledWith(
      WEBVIEW_ANNOTATION_BRIDGE_CHANNEL,
      expect.objectContaining({ type: 'editor_closed' })
    )
    expect(sendToHost).not.toHaveBeenCalledWith(WEBVIEW_KEYDOWN_CHANNEL, expect.anything())

    sendToHost.mockClear()
    keydown(trustedKey('Escape'))
    expect(sendToHost).toHaveBeenCalledWith(
      WEBVIEW_ANNOTATION_BRIDGE_CHANNEL,
      expect.objectContaining({ type: 'state_changed', enabled: false })
    )
  })

  it('cancels an annotation marquee on Escape without relaying it', () => {
    enableAnnotations()
    const target = document.createElement('section')
    target.id = 'marquee-target'
    Object.assign(target, { setPointerCapture: vi.fn(), hasPointerCapture: vi.fn(() => false) })
    document.body.appendChild(target)
    const pointer = (type: string, clientX: number, clientY: number) =>
      ({
        button: 0,
        clientX,
        clientY,
        composedPath: () => [target, document.body, document.documentElement, document, window],
        isPrimary: true,
        isTrusted: true,
        pointerId: 7,
        preventDefault: vi.fn(),
        stopImmediatePropagation: vi.fn(),
        target,
        type
      }) as unknown as PointerEvent
    inputListeners.get('pointerdown')?.(pointer('pointerdown', 10, 10))
    inputListeners.get('pointermove')?.(pointer('pointermove', 100, 100))
    sendToHost.mockClear()

    keydown(trustedKey('Escape'))

    expect(sendToHost).not.toHaveBeenCalledWith(WEBVIEW_KEYDOWN_CHANNEL, expect.anything())
    sendToHost.mockClear()
    keydown(trustedKey('Escape'))
    expect(sendToHost).toHaveBeenCalledWith(
      WEBVIEW_ANNOTATION_BRIDGE_CHANNEL,
      expect.objectContaining({ type: 'state_changed', enabled: false })
    )
  })
})

describe('stealth evasions and client hints delegation in webview preload', () => {
  beforeEach(async () => {
    vi.resetModules()
    await import('../webview')
  })

  it('delegates to native getHighEntropyValues and preserves supported hints such as formFactors', async () => {
    expect(executeJavaScriptInIsolatedWorld).toHaveBeenCalledWith(
      0,
      expect.arrayContaining([
        expect.objectContaining({
          code: expect.stringContaining('userAgentData')
        })
      ])
    )

    const injectedCode = executeJavaScriptInIsolatedWorld.mock.calls[0][1][0].code

    const nativeGetHighEntropyValues = vi.fn().mockImplementation(async (hints: string[]) => {
      const result: Record<string, unknown> = {
        brands: [
          { brand: 'Chromium', version: '132' },
          { brand: 'Electron', version: '44' }
        ],
        mobile: false,
        platform: 'Windows'
      }
      if (hints.includes('formFactors')) {
        result.formFactors = ['Desktop']
      }
      if (hints.includes('platformVersion')) {
        result.platformVersion = '15.0.0'
      }
      if (hints.includes('architecture')) {
        result.architecture = 'x86'
      }
      return result
    })

    const nativeTarget = Object.create({
      get mobile() {
        if (this !== nativeTarget) throw new TypeError('Illegal invocation')
        return false
      },
      get platform() {
        if (this !== nativeTarget) throw new TypeError('Illegal invocation')
        return 'Windows'
      }
    })
    Object.assign(nativeTarget, {
      brands: [
        { brand: 'Chromium', version: '132' },
        { brand: 'Electron', version: '44' }
      ],
      getHighEntropyValues: nativeGetHighEntropyValues,
      toJSON: () => ({ brands: [{ brand: 'Chromium', version: '132' }], mobile: false, platform: 'Windows' })
    })

    const testNav: { userAgentData?: Record<string, unknown> } = {
      userAgentData: nativeTarget
    }

    const runner = new Function('navigator', 'window', injectedCode)
    const testWin = { navigator: testNav }
    runner(testNav, testWin)

    expect(testNav.userAgentData?.brands).toEqual([
      { brand: 'Chromium', version: expect.any(String) },
      { brand: 'Google Chrome', version: expect.any(String) },
      { brand: 'Not A(Brand', version: '24' }
    ])

    // Verify reading native WebIDL getters preserves the target receiver (no TypeError: Illegal invocation)
    expect(testNav.userAgentData?.mobile).toBe(false)
    expect(testNav.userAgentData?.platform).toBe('Windows')
    const json = (testNav.userAgentData?.toJSON as () => Record<string, unknown>)()
    expect(json.platform).toBe('Windows')
    expect(json.mobile).toBe(false)

    const getHighEntropyValues = testNav.userAgentData?.getHighEntropyValues as (
      hints: string[]
    ) => Promise<Record<string, unknown>>

    // Supported hint outside the fixed dictionary (e.g. formFactors)
    const values = await getHighEntropyValues(['formFactors'])
    expect(nativeGetHighEntropyValues).toHaveBeenCalledWith(['formFactors'])
    expect(Array.isArray(values.formFactors)).toBe(true)
    expect((values.formFactors as string[]).includes('Desktop')).toBe(true)
    expect(values.brands).toEqual([
      { brand: 'Chromium', version: expect.any(String) },
      { brand: 'Google Chrome', version: expect.any(String) },
      { brand: 'Not A(Brand', version: '24' }
    ])

    // Preserves native host metadata such as Windows 11 platformVersion
    const metaValues = await getHighEntropyValues(['platformVersion', 'architecture'])
    expect(metaValues.platformVersion).toBe('15.0.0')
    expect(metaValues.architecture).toBe('x86')
  })
})
