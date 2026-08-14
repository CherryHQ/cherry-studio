import { beforeEach, describe, expect, it, vi } from 'vitest'

const { applicationMock, loggerMock, loadExtensionMock, installExtensionMock, platformMock, appMock } = vi.hoisted(
  () => {
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
    const appMock = { isPackaged: false, appPath: '/repo' }
    return { applicationMock, loggerMock, loadExtensionMock, installExtensionMock, platformMock, appMock }
  }
)

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
  app: {
    get isPackaged() {
      return appMock.isPackaged
    },
    getAppPath: () => appMock.appPath
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
    appMock.isPackaged = false
    appMock.appPath = '/repo'
    applicationMock.getPath.mockImplementation((key: string) => `/mock/${key}`)
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
    appMock.isPackaged = false
    appMock.appPath = '/repo'
    applicationMock.getPath.mockImplementation((key: string) => `/mock/${key}`)
    loadExtensionMock.mockResolvedValue({ id: 'main-network-extension-id', name: 'Main Network' })
  })

  it('loads a packaged panel from app.asar.unpacked, which Chromium can read off disk', async () => {
    appMock.isPackaged = true
    appMock.appPath = '/Applications/Cherry Studio.app/Contents/Resources/app.asar'
    applicationMock.getPath.mockImplementation(() => `${appMock.appPath}/resources`)

    await installBundledDevtools('main-network', 'Main Network')

    expect(loadExtensionMock).toHaveBeenCalledWith(
      '/Applications/Cherry Studio.app/Contents/Resources/app.asar.unpacked/resources/devtools/main-network'
    )
  })

  it('loads an unpackaged panel straight from the source tree', async () => {
    await installBundledDevtools('main-network', 'Main Network')

    expect(loadExtensionMock).toHaveBeenCalledWith('/mock/app.root.resources/devtools/main-network')
  })

  it('reports the resolved extension to its caller so the origin can be allowlisted', async () => {
    const onInstalled = vi.fn()

    await installBundledDevtools('main-network', 'Main Network', onInstalled)

    expect(onInstalled).toHaveBeenCalledWith({ id: 'main-network-extension-id', name: 'Main Network' })
  })
})
