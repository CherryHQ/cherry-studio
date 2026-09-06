import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  clearAllWebviewStates,
  clearWebviewState,
  getWebviewElement,
  onWebviewElementChange,
  onWebviewStateChange,
  setWebviewElement,
  setWebviewLoaded
} from '../webviewStateManager'

describe('webviewStateManager', () => {
  afterEach(() => {
    clearAllWebviewStates()
  })

  it('notifies mounted subscribers when a WebView is evicted and keeps them subscribed', () => {
    const listener = vi.fn()
    const unsubscribe = onWebviewStateChange('chatgpt', listener)

    setWebviewLoaded('chatgpt', true)
    clearWebviewState('chatgpt')
    setWebviewLoaded('chatgpt', true)

    expect(listener).toHaveBeenNthCalledWith(1, true)
    expect(listener).toHaveBeenNthCalledWith(2, false)
    expect(listener).toHaveBeenNthCalledWith(3, true)

    unsubscribe()
  })

  it('publishes the concrete WebView owned by the pool and clears it on eviction', () => {
    const first = { id: 'first' } as unknown as Electron.WebviewTag
    const replacement = { id: 'replacement' } as unknown as Electron.WebviewTag
    const observed: Array<Electron.WebviewTag | null> = []
    const unsubscribe = onWebviewElementChange('chatgpt', () => {
      observed.push(getWebviewElement('chatgpt'))
    })

    setWebviewElement('chatgpt', first)
    setWebviewElement('chatgpt', first)
    setWebviewElement('chatgpt', replacement)
    clearWebviewState('chatgpt')

    expect(observed).toEqual([first, replacement, null])
    expect(getWebviewElement('chatgpt')).toBeNull()

    unsubscribe()
  })
})
