import { beforeEach, describe, expect, it, vi } from 'vitest'

const { applicationMock, loggerMock, mainWindowServiceMock, settingsWindowServiceMock } = vi.hoisted(() => {
  const mainWindowServiceMock = {
    getMainWindow: vi.fn(),
    showMainWindow: vi.fn()
  }
  const settingsWindowServiceMock = {
    open: vi.fn()
  }
  const loggerMock = {
    debug: vi.fn(),
    error: vi.fn(),
    warn: vi.fn()
  }
  const applicationMock = {
    get: vi.fn((name: string) => {
      if (name === 'MainWindowService') return mainWindowServiceMock
      if (name === 'SettingsWindowService') return settingsWindowServiceMock
      throw new Error(`unexpected service: ${name}`)
    })
  }
  return { applicationMock, loggerMock, mainWindowServiceMock, settingsWindowServiceMock }
})

vi.mock('@application', () => ({ application: applicationMock }))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => loggerMock
  }
}))

vi.mock('@main/constant', () => ({
  isMac: false
}))

import { handleNavigateProtocolUrl } from '../navigate'

describe('navigate protocol handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useRealTimers()
  })

  it('blocks paths outside the route allowlist', () => {
    handleNavigateProtocolUrl(new URL('cherrystudio://navigate/agents-legacy'))

    expect(loggerMock.warn).toHaveBeenCalledWith('Blocked navigation to disallowed route: /agents-legacy')
    expect(mainWindowServiceMock.getMainWindow).not.toHaveBeenCalled()
  })

  it('opens settings routes through SettingsWindowService', () => {
    handleNavigateProtocolUrl(new URL('cherrystudio://navigate/settings/provider?id=openai'))

    expect(settingsWindowServiceMock.open).toHaveBeenCalledWith('/settings/provider?id=openai')
    expect(mainWindowServiceMock.getMainWindow).not.toHaveBeenCalled()
  })

  it('passes query strings to window.navigate without string interpolation injection', async () => {
    const executeJavaScript = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(undefined)
    mainWindowServiceMock.getMainWindow.mockReturnValue({
      isDestroyed: () => false,
      webContents: { executeJavaScript }
    })

    handleNavigateProtocolUrl(new URL("cherrystudio://navigate/agents?x=');attackerCode();//"))
    await vi.waitFor(() => {
      expect(executeJavaScript).toHaveBeenCalledTimes(2)
    })

    expect(executeJavaScript).toHaveBeenNthCalledWith(1, `typeof window.navigate === 'function'`)
    expect(executeJavaScript).toHaveBeenNthCalledWith(
      2,
      `window.navigate({ to: ${JSON.stringify("/agents?x=');attackerCode();//")} })`
    )
  })

  it('retries when the main window is not available yet', () => {
    vi.useFakeTimers()
    mainWindowServiceMock.getMainWindow.mockReturnValue(null)

    handleNavigateProtocolUrl(new URL('cherrystudio://navigate/agents'))

    expect(mainWindowServiceMock.getMainWindow).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(1000)

    expect(mainWindowServiceMock.getMainWindow).toHaveBeenCalledTimes(2)
  })

  it('drops the navigation after MAX_NAVIGATE_RETRY_ATTEMPTS retries when the main window never appears', async () => {
    // T7: pin the retry cap. Initial call + 30 retries = 31 getMainWindow
    // calls, then the cap fires the warn-drop. A regression that lost the
    // cap (infinite retry) would never trigger the dropping warn.
    vi.useFakeTimers()
    mainWindowServiceMock.getMainWindow.mockReturnValue(null)

    handleNavigateProtocolUrl(new URL('cherrystudio://navigate/agents'))
    expect(mainWindowServiceMock.getMainWindow).toHaveBeenCalledTimes(1)

    for (let attempt = 0; attempt < 30; attempt++) {
      await vi.advanceTimersByTimeAsync(1000)
    }

    expect(mainWindowServiceMock.getMainWindow).toHaveBeenCalledTimes(31)

    // One more tick beyond the cap must NOT schedule another retry.
    await vi.advanceTimersByTimeAsync(1000)
    expect(mainWindowServiceMock.getMainWindow).toHaveBeenCalledTimes(31)

    expect(loggerMock.warn).toHaveBeenCalledWith(
      'Main window not available, dropping navigation URL after retry limit',
      expect.objectContaining({ path: '/agents' })
    )
  })

  it('retries when window.navigate is not yet loaded and stops at the cap', async () => {
    // T7: the hasNavigate=false path has its own retry leg. Same cap applies.
    vi.useFakeTimers()
    const executeJavaScript = vi.fn().mockResolvedValue(false)
    mainWindowServiceMock.getMainWindow.mockReturnValue({
      isDestroyed: () => false,
      webContents: { executeJavaScript }
    })

    handleNavigateProtocolUrl(new URL('cherrystudio://navigate/agents'))

    for (let attempt = 0; attempt < 31; attempt++) {
      await vi.advanceTimersByTimeAsync(1000)
    }

    expect(loggerMock.warn).toHaveBeenCalledWith(
      'window.navigate not available, dropping navigation URL after retry limit',
      expect.objectContaining({ path: '/agents' })
    )
  })
})
