import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  browserWindowConstructedMock,
  loadURLMock,
  destroyMock,
  loggerWarnMock,
  onceMock,
  removeListenerMock,
  executeJavaScriptMock
} = vi.hoisted(() => ({
  browserWindowConstructedMock: vi.fn(),
  loadURLMock: vi.fn(),
  destroyMock: vi.fn(),
  loggerWarnMock: vi.fn(),
  onceMock: vi.fn(),
  removeListenerMock: vi.fn(),
  executeJavaScriptMock: vi.fn()
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: loggerWarnMock,
      error: vi.fn()
    })
  }
}))

vi.mock('electron', () => {
  class MockBrowserWindow {
    public webContents = {
      userAgent: '',
      setWindowOpenHandler: vi.fn(),
      once: onceMock,
      removeListener: removeListenerMock,
      executeJavaScript: executeJavaScriptMock
    }

    public isDestroyed = vi.fn(() => false)
    public destroy = destroyMock
    public loadURL = loadURLMock

    constructor() {
      browserWindowConstructedMock()
    }
  }

  return {
    BrowserWindow: MockBrowserWindow as any
  }
})

import { localBrowser } from '../LocalBrowser'

describe('LocalBrowser', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useRealTimers()
    loadURLMock.mockResolvedValue(undefined)
    onceMock.mockImplementation(() => undefined)
    executeJavaScriptMock.mockResolvedValue('<html></html>')
  })

  it('rejects non-HTTP URLs before creating a BrowserWindow', async () => {
    await expect(localBrowser.fetchHtml('file:///tmp/test.html')).rejects.toThrow(
      'LocalBrowser only supports HTTP(S) URLs: file:///tmp/test.html'
    )

    expect(browserWindowConstructedMock).not.toHaveBeenCalled()
  })

  it('logs navigation failures at warn level', async () => {
    loadURLMock.mockRejectedValueOnce(new Error('navigation failed'))

    await expect(localBrowser.fetchHtml('https://example.com')).rejects.toThrow('navigation failed')

    expect(loggerWarnMock).toHaveBeenCalledWith('LocalBrowser navigation failed', {
      url: 'https://example.com',
      timeoutMs: 10000,
      error: 'navigation failed'
    })
    expect(destroyMock).toHaveBeenCalledTimes(1)
  })

  it('limits concurrent BrowserWindow fetches', async () => {
    const firstController = new AbortController()
    const secondController = new AbortController()

    loadURLMock
      .mockImplementationOnce(() => new Promise(() => {}))
      .mockImplementationOnce(() => new Promise(() => {}))
      .mockRejectedValueOnce(new Error('third failed'))

    const firstFetch = localBrowser.fetchHtml('https://example.com/first', {
      signal: firstController.signal
    })
    const secondFetch = localBrowser.fetchHtml('https://example.com/second', {
      signal: secondController.signal
    })
    const thirdFetch = localBrowser.fetchHtml('https://example.com/third')

    await vi.waitFor(() => {
      expect(browserWindowConstructedMock).toHaveBeenCalledTimes(2)
    })

    firstController.abort()
    await expect(firstFetch).rejects.toThrow('The operation was aborted')

    await expect(thirdFetch).rejects.toThrow('third failed')

    await vi.waitFor(() => {
      expect(browserWindowConstructedMock).toHaveBeenCalledTimes(3)
    })

    secondController.abort()
    await expect(secondFetch).rejects.toThrow('The operation was aborted')
  })

  it('rejects queued fetches before acquiring a BrowserWindow when aborted', async () => {
    const firstController = new AbortController()
    const secondController = new AbortController()
    const thirdController = new AbortController()

    loadURLMock.mockImplementation(() => new Promise(() => {}))

    const firstFetch = localBrowser.fetchHtml('https://example.com/first', {
      signal: firstController.signal
    })
    const secondFetch = localBrowser.fetchHtml('https://example.com/second', {
      signal: secondController.signal
    })
    const thirdFetch = localBrowser.fetchHtml('https://example.com/third', {
      signal: thirdController.signal
    })

    await vi.waitFor(() => {
      expect(browserWindowConstructedMock).toHaveBeenCalledTimes(2)
    })

    const thirdAssertion = expect(thirdFetch).rejects.toThrow('The operation was aborted')
    thirdController.abort()
    await thirdAssertion

    firstController.abort()
    secondController.abort()
    await expect(firstFetch).rejects.toThrow('The operation was aborted')
    await expect(secondFetch).rejects.toThrow('The operation was aborted')

    await vi.waitFor(() => {
      expect(browserWindowConstructedMock).toHaveBeenCalledTimes(2)
    })
  })

  it('rejects if aborted during the post-load delay before extracting the HTML snapshot', async () => {
    vi.useFakeTimers()

    const controller = new AbortController()
    let readyHandler: (() => void) | undefined

    onceMock.mockImplementation((event, callback) => {
      if (event === 'did-finish-load') {
        readyHandler = callback as () => void
      }
    })

    const fetchPromise = localBrowser.fetchHtml('https://example.com/delay-abort', {
      signal: controller.signal
    })

    await Promise.resolve()

    const abortAssertion = expect(fetchPromise).rejects.toThrow('The operation was aborted')

    readyHandler?.()
    await vi.advanceTimersByTimeAsync(100)
    controller.abort()

    await abortAssertion

    expect(executeJavaScriptMock).not.toHaveBeenCalled()
    expect(destroyMock).toHaveBeenCalledTimes(1)
  })
})
