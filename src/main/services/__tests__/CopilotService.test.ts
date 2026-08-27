import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { decryptStringMock, existsSyncMock, netFetchMock, readFileMock } = vi.hoisted(() => ({
  decryptStringMock: vi.fn(),
  existsSyncMock: vi.fn(),
  netFetchMock: vi.fn(),
  readFileMock: vi.fn()
}))

vi.mock('electron', () => ({
  net: { fetch: netFetchMock },
  safeStorage: {
    decryptString: decryptStringMock,
    encryptString: vi.fn()
  }
}))

vi.mock('fs', () => ({
  default: {
    existsSync: existsSyncMock,
    promises: {
      readFile: readFileMock
    }
  }
}))

import { copilotService } from '../CopilotService'

const GITHUB_DEVICE_CODE_URL = 'https://github.com/login/device/code'
const GITHUB_ACCESS_TOKEN_URL = 'https://github.com/login/oauth/access_token'
const COPILOT_TOKEN_URL = 'https://api.github.com/copilot_internal/v2/token'
const IPC_EVENT = undefined as unknown as Electron.IpcMainInvokeEvent

const fetchResponse = (body: unknown) => ({
  ok: true,
  status: 200,
  statusText: 'OK',
  json: async () => body
})

const getRequestHeaders = (url: string): Record<string, string> => {
  const call = netFetchMock.mock.calls.find(([requestUrl]) => requestUrl === url)
  if (!call) {
    throw new Error(`No request captured for ${url}`)
  }
  return (call[1] as { headers: Record<string, string> }).headers
}

const countHeaderKeys = (headers: Record<string, string>, name: string): number =>
  Object.keys(headers).filter((headerName) => headerName.toLowerCase() === name.toLowerCase()).length

describe('CopilotService headers', () => {
  beforeEach(() => {
    netFetchMock.mockReset()
    decryptStringMock.mockReset().mockReturnValue('github-access-token')
    existsSyncMock.mockReset().mockReturnValue(false)
    readFileMock.mockReset().mockResolvedValue(Buffer.from('encrypted-token'))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('preserves the device-code JSON contract while merging custom headers without leaks', async () => {
    netFetchMock.mockResolvedValue(
      fetchResponse({
        device_code: 'device-code',
        user_code: 'user-code',
        verification_uri: 'https://github.com/login/device'
      })
    )

    await copilotService.getAuthMessage(IPC_EVENT, {
      Accept: 'application/xml',
      'Content-Type': 'text/plain',
      'User-Agent': 'custom-agent',
      'X-Custom': '1'
    })

    const customHeaders = getRequestHeaders(GITHUB_DEVICE_CODE_URL)
    const normalizedCustomHeaders = new Headers(customHeaders)
    expect(normalizedCustomHeaders.get('accept')).toBe('application/json')
    expect(normalizedCustomHeaders.get('content-type')).toBe('application/json')
    expect(normalizedCustomHeaders.get('editor-version')).toBe('Neovim/0.6.1')
    expect(normalizedCustomHeaders.get('user-agent')).toBe('custom-agent')
    expect(normalizedCustomHeaders.get('x-custom')).toBe('1')
    expect(countHeaderKeys(customHeaders, 'accept')).toBe(1)
    expect(countHeaderKeys(customHeaders, 'content-type')).toBe(1)
    expect(countHeaderKeys(customHeaders, 'user-agent')).toBe(1)

    netFetchMock.mockClear()
    await copilotService.getAuthMessage(IPC_EVENT)

    const defaultHeaders = new Headers(getRequestHeaders(GITHUB_DEVICE_CODE_URL))
    expect(defaultHeaders.get('accept')).toBe('application/json')
    expect(defaultHeaders.get('editor-version')).toBe('Neovim/0.6.1')
    expect(defaultHeaders.get('user-agent')).toBe('Visual Studio Code (desktop)')
    expect(defaultHeaders.has('x-custom')).toBe(false)
  })

  it('merges custom headers with access-token polling defaults case-insensitively', async () => {
    vi.useFakeTimers()
    netFetchMock.mockResolvedValue(fetchResponse({ access_token: 'github-access-token' }))

    const tokenPromise = copilotService.getCopilotToken(IPC_EVENT, 'device-code', {
      'CONTENT-TYPE': 'text/plain',
      'Editor-Version': 'custom-editor'
    })
    await vi.advanceTimersByTimeAsync(1000)

    await expect(tokenPromise).resolves.toEqual({ access_token: 'github-access-token' })
    const requestHeaders = getRequestHeaders(GITHUB_ACCESS_TOKEN_URL)
    const normalizedHeaders = new Headers(requestHeaders)
    expect(normalizedHeaders.get('accept')).toBe('application/json')
    expect(normalizedHeaders.get('content-type')).toBe('application/json')
    expect(normalizedHeaders.get('editor-version')).toBe('custom-editor')
    expect(normalizedHeaders.get('user-agent')).toBe('Visual Studio Code (desktop)')
    expect(countHeaderKeys(requestHeaders, 'content-type')).toBe(1)
    expect(countHeaderKeys(requestHeaders, 'editor-version')).toBe(1)
  })

  it('merges custom headers with Copilot-token defaults and preserves service authorization', async () => {
    netFetchMock.mockResolvedValue(fetchResponse({ token: 'copilot-token' }))

    await expect(
      copilotService.getToken(IPC_EVENT, {
        'USER-AGENT': 'custom-agent'
      })
    ).resolves.toEqual({ token: 'copilot-token' })

    const requestHeaders = getRequestHeaders(COPILOT_TOKEN_URL)
    const normalizedHeaders = new Headers(requestHeaders)
    expect(normalizedHeaders.get('accept')).toBe('application/json')
    expect(normalizedHeaders.get('editor-version')).toBe('Neovim/0.6.1')
    expect(normalizedHeaders.get('user-agent')).toBe('custom-agent')
    expect(normalizedHeaders.get('authorization')).toBe('token github-access-token')
    expect(countHeaderKeys(requestHeaders, 'user-agent')).toBe(1)
  })

  it('keeps headers isolated when token requests interleave', async () => {
    vi.useFakeTimers()
    netFetchMock.mockImplementation(async (url: string) =>
      fetchResponse(
        url === GITHUB_ACCESS_TOKEN_URL ? { access_token: 'github-access-token' } : { token: 'copilot-token' }
      )
    )

    const pollingPromise = copilotService.getCopilotToken(IPC_EVENT, 'device-code', {
      'X-Request': 'polling'
    })
    const copilotTokenPromise = copilotService.getToken(IPC_EVENT, {
      'X-Request': 'copilot-token'
    })

    await expect(copilotTokenPromise).resolves.toEqual({ token: 'copilot-token' })
    await vi.advanceTimersByTimeAsync(1000)
    await expect(pollingPromise).resolves.toEqual({ access_token: 'github-access-token' })

    expect(new Headers(getRequestHeaders(COPILOT_TOKEN_URL)).get('x-request')).toBe('copilot-token')
    expect(new Headers(getRequestHeaders(GITHUB_ACCESS_TOKEN_URL)).get('x-request')).toBe('polling')
  })
})
