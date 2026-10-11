import { beforeEach, describe, expect, it, vi } from 'vitest'

const { applicationMock, loggerMock, loadExtensionMock, installExtensionMock, platformMock, toAsarUnpackedPathMock } =
  vi.hoisted(() => {
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
    const toAsarUnpackedPathMock = vi.fn((filePath: string) => filePath)
    return {
      applicationMock,
      loggerMock,
      loadExtensionMock,
      installExtensionMock,
      platformMock,
      toAsarUnpackedPathMock
    }
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

vi.mock('@main/utils/asar', () => ({
  toAsarUnpackedPath: toAsarUnpackedPathMock
}))

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: vi.fn(() => '/mock/app')
  },
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

import { installBundledDevtools, installDevtoolsExtensions } from '../devtools'

describe('installDevtoolsExtensions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    platformMock.isDev = true
    toAsarUnpackedPathMock.mockImplementation((filePath: string) => filePath)
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

describe('installBundledDevtools', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    toAsarUnpackedPathMock.mockImplementation((filePath: string) =>
      filePath.replace('/app.asar/', '/app.asar.unpacked/')
    )
    loadExtensionMock.mockResolvedValue({ id: 'main-network-extension-id', name: 'Main Network' })
  })

  it('resolves the extension directory through toAsarUnpackedPath before loadExtension', async () => {
    applicationMock.getPath.mockImplementation((key: string) => {
      if (key === 'app.root.resources') return '/app.asar/resources'
      return `/mock/${key}`
    })

    await installBundledDevtools('main-network', 'Main Network')

    expect(toAsarUnpackedPathMock).toHaveBeenCalledWith('/app.asar/resources/devtools/main-network')
    expect(loadExtensionMock).toHaveBeenCalledWith('/app.asar.unpacked/resources/devtools/main-network')
  })
})
