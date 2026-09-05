// @vitest-environment jsdom

import { WEBVIEW_ANNOTATION_BRIDGE_CHANNEL, type WebviewAnnotationHostCommand } from '@shared/types/webviewAnnotation'
import { MINI_APP_KEYDOWN_CHANNEL } from '@shared/utils/webviewKey'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const sendToHost = vi.fn()
const ipcListeners = new Map<string, (event: unknown, value: unknown) => void>()

vi.mock('electron', () => ({
  ipcRenderer: {
    on: (channel: string, listener: (event: unknown, value: unknown) => void) => ipcListeners.set(channel, listener),
    sendToHost
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
      MINI_APP_KEYDOWN_CHANNEL,
      expect.objectContaining({ key: 'Escape', isTrusted: true })
    )
  })

  it('lets annotations own Escape without relaying it to the host', () => {
    enableAnnotations()
    const event = trustedKey('Escape')

    keydown(event)

    expect(event.preventDefault).toHaveBeenCalledOnce()
    expect(event.stopImmediatePropagation).toHaveBeenCalledOnce()
    expect(sendToHost).not.toHaveBeenCalledWith(MINI_APP_KEYDOWN_CHANNEL, expect.anything())
  })

  it('still relays non-Escape host shortcuts while annotations are active', () => {
    enableAnnotations()
    const event = trustedKey('f', { ctrlKey: true })

    keydown(event)

    expect(event.preventDefault).toHaveBeenCalledOnce()
    expect(sendToHost).toHaveBeenCalledWith(
      MINI_APP_KEYDOWN_CHANNEL,
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
    expect(sendToHost).not.toHaveBeenCalledWith(MINI_APP_KEYDOWN_CHANNEL, expect.anything())

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

    expect(sendToHost).not.toHaveBeenCalledWith(MINI_APP_KEYDOWN_CHANNEL, expect.anything())
    sendToHost.mockClear()
    keydown(trustedKey('Escape'))
    expect(sendToHost).toHaveBeenCalledWith(
      WEBVIEW_ANNOTATION_BRIDGE_CHANNEL,
      expect.objectContaining({ type: 'state_changed', enabled: false })
    )
  })
})
