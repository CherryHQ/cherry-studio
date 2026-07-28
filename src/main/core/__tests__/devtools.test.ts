import { beforeEach, describe, expect, it, vi } from 'vitest'

const { applicationMock, loggerMock, loadExtensionMock, installExtensionMock, platformMock } = vi.hoisted(() => {
  const applicationMock = {
    getPath: vi.fn((key: string) => `/mock/${key}`)
  }
  const loggerMock = {
    error: vi.fn(),
    info: vi.fn()
  }
  const loadExtensionMock = vi.fn()
  const installExtensionMock = vi.fn()
  // Mutable so individual tests can toggle dev/non-dev. Read via a getter in the
  // mock below, since `isDev` is a module-load-time constant otherwise.
  const platformMock = { isDev: true }
  return { applicationMock, loggerMock, loadExtensionMock, installExtensionMock, platformMock }
})

vi.mock('@application', () => ({
  application: applicationMock
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => loggerMock
  }
}))

vi.mock('@main/core/platform', () => ({
  get isDev() {
    return platformMock.isDev
  }
}))

vi.mock('electron', () => ({
  session: {
    defaultSession: {
      extensions: {
        loadExtension: loadExtensionMock
      }
    }
  }
}))

vi.mock('electron-devtools-installer', () => ({
  default: installExtensionMock,
  REACT_DEVELOPER_TOOLS: 'react-devtools'
}))

import { installDevtoolsExtensions } from '../devtools'

describe('installDevtoolsExtensions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    platformMock.isDev = true
    installExtensionMock.mockResolvedValue('React Developer Tools')
    loadExtensionMock.mockResolvedValue({ id: 'data-api-extension-id', name: 'DataApi DevTools' })
  })

  it('installs React and the bundled data-api devtool in development', async () => {
    await installDevtoolsExtensions()

    expect(installExtensionMock).toHaveBeenCalledWith('react-devtools')
    expect(loadExtensionMock).toHaveBeenCalledWith('/mock/app.root.resources/devtools/data-api')
    expect(loggerMock.info).toHaveBeenCalledWith('Added Extension: React Developer Tools')
    expect(loggerMock.info).toHaveBeenCalledWith('Added Extension: DataApi DevTools')
    // main-network is no longer installed by core — its service installs its own panel.
    expect(loadExtensionMock).not.toHaveBeenCalledWith('/mock/app.root.resources/devtools/main-network')
  })

  it('logs install failures without throwing', async () => {
    const reactError = new Error('react failed')
    const dataApiError = new Error('data api failed')
    installExtensionMock.mockRejectedValue(reactError)
    loadExtensionMock.mockRejectedValue(dataApiError)

    await expect(installDevtoolsExtensions()).resolves.toBeUndefined()

    expect(loggerMock.error).toHaveBeenCalledWith('Failed to install React Developer Tools extension', reactError)
    expect(loggerMock.error).toHaveBeenCalledWith('Failed to install DataApi DevTools extension', dataApiError)
  })

  it('is a no-op outside development', async () => {
    platformMock.isDev = false

    await installDevtoolsExtensions()

    expect(installExtensionMock).not.toHaveBeenCalled()
    expect(loadExtensionMock).not.toHaveBeenCalled()
  })
})
