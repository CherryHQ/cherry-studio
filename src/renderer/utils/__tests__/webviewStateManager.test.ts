import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  clearAllWebviewStates,
  clearWebviewState,
  getWebviewLoaded,
  onWebviewRecreateRequest,
  onWebviewStateChange,
  requestWebviewRecreate,
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

  it('clears readiness and emits every full WebView recreation request', () => {
    const stateListener = vi.fn()
    const recreateListener = vi.fn(() => {
      expect(getWebviewLoaded('comfyui')).toBe(false)
    })
    const unsubscribeState = onWebviewStateChange('comfyui', stateListener)
    const unsubscribeRecreate = onWebviewRecreateRequest(recreateListener)

    setWebviewLoaded('comfyui', true)
    requestWebviewRecreate('comfyui')
    requestWebviewRecreate('comfyui')

    expect(stateListener).toHaveBeenNthCalledWith(1, true)
    expect(stateListener).toHaveBeenNthCalledWith(2, false)
    expect(stateListener).toHaveBeenNthCalledWith(3, false)
    expect(recreateListener).toHaveBeenCalledTimes(2)
    expect(recreateListener).toHaveBeenCalledWith('comfyui')

    unsubscribeState()
    unsubscribeRecreate()
  })
})
