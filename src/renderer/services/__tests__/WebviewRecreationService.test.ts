import { afterEach, describe, expect, it } from 'vitest'

import { clearAllWebviewStates, getWebviewLoaded, setWebviewLoaded } from '@renderer/services/MiniAppWebviewService'

import { webviewRecreationService } from '../WebviewRecreationService'

const subscriptions: Array<() => void> = []

afterEach(() => {
  subscriptions.splice(0).forEach((unsubscribe) => unsubscribe())
  clearAllWebviewStates()
})

describe('WebviewRecreationService', () => {
  it('clears only the requested app readiness before delivering every restart', () => {
    const requests: Array<{ appId: string; loaded: boolean }> = []
    subscriptions.push(
      webviewRecreationService.subscribe((appId) => {
        requests.push({ appId, loaded: getWebviewLoaded(appId) })
      })
    )
    setWebviewLoaded('comfyui', true)
    setWebviewLoaded('chatgpt', true)

    webviewRecreationService.request('comfyui')
    webviewRecreationService.request('comfyui')

    expect(requests).toEqual([
      { appId: 'comfyui', loaded: false },
      { appId: 'comfyui', loaded: false }
    ])
    expect(getWebviewLoaded('chatgpt')).toBe(true)
  })

  it('stops delivering requests after a subscriber unmounts', () => {
    const requests: string[] = []
    const unsubscribe = webviewRecreationService.subscribe((appId) => requests.push(appId))
    subscriptions.push(unsubscribe)

    webviewRecreationService.request('comfyui')
    unsubscribe()
    webviewRecreationService.request('chatgpt')

    expect(requests).toEqual(['comfyui'])
  })

  it.each([
    new Error('Detached subscriber'),
    null,
    undefined,
    'Detached subscriber',
    { message: 'Detached subscriber' }
  ])('delivers the request to the pool even when another subscriber throws %j', (error: unknown) => {
    const requests: string[] = []
    subscriptions.push(
      webviewRecreationService.subscribe(() => {
        throw error
      }),
      webviewRecreationService.subscribe((appId) => requests.push(appId))
    )

    webviewRecreationService.request('comfyui')

    expect(requests).toEqual(['comfyui'])
  })
})
