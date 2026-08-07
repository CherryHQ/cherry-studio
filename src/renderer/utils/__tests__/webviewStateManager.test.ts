import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  clearAllWebviewStates,
  clearWebviewState,
  onWebviewStateChange,
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
})
