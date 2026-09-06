import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  decrypt: vi.fn(),
  getLanguageCode: vi.fn(async () => 'en-US'),
  loggerError: vi.fn(),
  toastError: vi.fn(),
  translate: vi.fn((key: string) => key)
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      debug: vi.fn(),
      error: mocks.loggerError,
      warn: vi.fn()
    })
  }
}))

vi.mock('@renderer/i18n/resolver', () => ({
  default: { t: mocks.translate },
  getLanguageCode: mocks.getLanguageCode
}))

vi.mock('@renderer/ipc', () => ({
  ipcApi: {
    on: vi.fn(),
    request: vi.fn()
  }
}))

vi.mock('@renderer/services/toast', () => ({
  toast: { error: mocks.toastError }
}))

import {
  oauthWith302AI,
  oauthWithAihubmix,
  oauthWithAiOnly,
  oauthWithSiliconFlow,
  providerBills,
  providerCharge
} from '../oauth'

interface MockPopup {
  closed: boolean
  close: ReturnType<typeof vi.fn>
}

const openedPopups: MockPopup[] = []

function createPopup(): MockPopup {
  const popup: MockPopup = {
    closed: false,
    close: vi.fn(() => {
      popup.closed = true
    })
  }
  openedPopups.push(popup)
  return popup
}

function dispatchPopupMessage(popup: MockPopup, origin: string, data: unknown): void {
  window.dispatchEvent(
    new MessageEvent('message', {
      data,
      origin,
      source: popup as unknown as Window
    })
  )
}

describe('popup message OAuth flows', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    openedPopups.length = 0
    mocks.getLanguageCode.mockResolvedValue('en-US')
    mocks.decrypt.mockResolvedValue(JSON.stringify({ api_keys: [{ value: 'aihubmix-key' }] }))

    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { aes: { decrypt: mocks.decrypt } }
    })
    vi.spyOn(window, 'open').mockImplementation(() => createPopup() as unknown as Window)
  })

  afterEach(() => {
    for (const popup of openedPopups) popup.closed = true
    vi.advanceTimersByTime(500)
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('accepts only the expected Silicon popup and origin, then removes the listener', async () => {
    const setKey = vi.fn()
    await oauthWithSiliconFlow(setKey)
    const popup = openedPopups[0]
    const otherPopup = createPopup()
    const payload = [{ secretKey: 'silicon-key' }]

    dispatchPopupMessage(popup, 'https://attacker.example', payload)
    dispatchPopupMessage(otherPopup, 'https://account.siliconflow.cn', payload)
    expect(setKey).not.toHaveBeenCalled()

    dispatchPopupMessage(popup, 'https://account.siliconflow.cn', payload)
    await vi.waitFor(() => expect(setKey).toHaveBeenCalledWith('silicon-key'))

    expect(setKey).toHaveBeenCalledOnce()
    expect(popup.close).toHaveBeenCalledOnce()

    dispatchPopupMessage(popup, 'https://account.siliconflow.cn', payload)
    expect(setKey).toHaveBeenCalledOnce()
  })

  it('retires the previous handler when another flow reuses the oauth popup name', async () => {
    const setSiliconKey = vi.fn()
    const set302Key = vi.fn()
    await oauthWithSiliconFlow(setSiliconKey)
    const siliconPopup = openedPopups[0]

    await oauthWith302AI(set302Key)
    const popup302 = openedPopups[1]

    dispatchPopupMessage(siliconPopup, 'https://account.siliconflow.cn', [{ secretKey: 'stale-key' }])
    dispatchPopupMessage(popup302, 'https://dash.302.ai', { data: { apikey: '302-key' } })
    await vi.waitFor(() => expect(set302Key).toHaveBeenCalledWith('302-key'))

    expect(setSiliconKey).not.toHaveBeenCalled()
  })

  it('keeps the previous flow active when its replacement popup is blocked', async () => {
    const setSiliconKey = vi.fn()
    await oauthWithSiliconFlow(setSiliconKey)
    const siliconPopup = openedPopups[0]

    vi.mocked(window.open).mockReturnValueOnce(null)
    await oauthWith302AI(vi.fn())

    dispatchPopupMessage(siliconPopup, 'https://account.siliconflow.cn', [{ secretKey: 'silicon-key' }])
    await vi.waitFor(() => expect(setSiliconKey).toHaveBeenCalledWith('silicon-key'))
  })

  it.each([
    ['charge', providerCharge],
    ['bills', providerBills]
  ] as const)('retires the OAuth handler when the named popup is reused for %s', async (_label, openPage) => {
    const setKey = vi.fn()
    await oauthWithSiliconFlow(setKey)
    const oauthPopup = openedPopups[0]

    await openPage('silicon')
    dispatchPopupMessage(oauthPopup, 'https://account.siliconflow.cn', [{ secretKey: 'stale-key' }])

    expect(setKey).not.toHaveBeenCalled()
  })

  it('removes a handler when its popup closes', async () => {
    const setKey = vi.fn()
    await oauthWith302AI(setKey)
    const popup = openedPopups[0]

    popup.closed = true
    vi.advanceTimersByTime(500)
    dispatchPopupMessage(popup, 'https://dash.302.ai', { data: { apikey: 'late-key' } })

    expect(setKey).not.toHaveBeenCalled()
  })

  it('removes a handler when the flow times out', async () => {
    const setKey = vi.fn()
    await oauthWith302AI(setKey)
    const popup = openedPopups[0]

    vi.advanceTimersByTime(10 * 60 * 1000)
    dispatchPopupMessage(popup, 'https://dash.302.ai', { data: { apikey: 'late-key' } })

    expect(setKey).not.toHaveBeenCalled()
  })

  it('cleans up a recognized malformed Aihubmix callback', async () => {
    const setKey = vi.fn()
    await oauthWithAihubmix(setKey)
    const popup = openedPopups[0]

    dispatchPopupMessage(popup, 'https://console.inferera.com', {
      key: 'cherry_studio_oauth_callback',
      data: { iv: 42 }
    })
    await vi.waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith('settings.provider.oauth.error'))

    expect(mocks.decrypt).not.toHaveBeenCalled()
    expect(setKey).not.toHaveBeenCalled()
    expect(popup.close).toHaveBeenCalledOnce()

    dispatchPopupMessage(popup, 'https://console.inferera.com', {
      key: 'cherry_studio_oauth_callback',
      data: { iv: 'iv', encryptedData: 'ciphertext' }
    })
    expect(mocks.decrypt).not.toHaveBeenCalled()
  })

  it('finishes processing a valid callback after its popup closes', async () => {
    let resolveDecryption: (value: string) => void = () => undefined
    mocks.decrypt.mockReturnValueOnce(
      new Promise<string>((resolve) => {
        resolveDecryption = resolve
      })
    )
    const setKey = vi.fn()
    await oauthWithAihubmix(setKey)
    const popup = openedPopups[0]

    dispatchPopupMessage(popup, 'https://console.inferera.com', {
      key: 'cherry_studio_oauth_callback',
      data: { iv: 'iv', encryptedData: 'ciphertext' }
    })
    await vi.waitFor(() => expect(mocks.decrypt).toHaveBeenCalledOnce())

    popup.closed = true
    vi.advanceTimersByTime(500)
    resolveDecryption(JSON.stringify({ api_keys: [{ value: 'callback-key' }] }))

    await vi.waitFor(() => expect(setKey).toHaveBeenCalledWith('callback-key'))
  })

  it('preserves successful Aihubmix decryption and AiOnly key handling', async () => {
    const setAihubmixKey = vi.fn()
    await oauthWithAihubmix(setAihubmixKey)
    const aihubmixPopup = openedPopups[0]

    dispatchPopupMessage(aihubmixPopup, 'https://console.inferera.com', {
      key: 'cherry_studio_oauth_callback',
      data: { iv: 'iv', encryptedData: 'ciphertext' }
    })
    await vi.waitFor(() => expect(setAihubmixKey).toHaveBeenCalledWith('aihubmix-key'))

    expect(mocks.decrypt).toHaveBeenCalledWith('ciphertext', 'iv', '')

    const setAiOnlyKey = vi.fn()
    await oauthWithAiOnly(setAiOnlyKey)
    const aiOnlyPopup = openedPopups[1]
    dispatchPopupMessage(aiOnlyPopup, 'https://maas.aiionly.com', [{ secretKey: 'aionly-key' }])
    await vi.waitFor(() => expect(setAiOnlyKey).toHaveBeenCalledWith('aionly-key'))

    expect(aiOnlyPopup.close).toHaveBeenCalledOnce()
  })
})
