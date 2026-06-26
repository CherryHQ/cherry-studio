import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { platformState, applicationMock, loggerMock, loadExtensionMock, installExtensionMock } = vi.hoisted(() => {
  const platformState = { isDev: false }
  const applicationMock = {
    getPath: vi.fn((key: string) => `/mock/${key}`)
  }
  const loggerMock = {
    error: vi.fn(),
    info: vi.fn()
  }
  const loadExtensionMock = vi.fn()
  const installExtensionMock = vi.fn()
  return { platformState, applicationMock, loggerMock, loadExtensionMock, installExtensionMock }
})

vi.mock('@main/core/platform', () => ({
  get isDev() {
    return platformState.isDev
  }
}))

vi.mock('@application', () => ({
  application: applicationMock
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => loggerMock
  }
}))

vi.mock('electron', () => ({
  session: {
    defaultSession: {
      loadExtension: loadExtensionMock
    }
  }
}))

vi.mock('electron-devtools-installer', () => ({
  default: installExtensionMock,
  REACT_DEVELOPER_TOOLS: 'react-devtools'
}))

import { DevtoolsExtensionService } from '../DevtoolsExtensionService'

describe('DevtoolsExtensionService', () => {
  let service: DevtoolsExtensionService

  beforeAll(() => {
    service = new DevtoolsExtensionService()
  })

  beforeEach(() => {
    platformState.isDev = false
    vi.clearAllMocks()
    installExtensionMock.mockResolvedValue('React Developer Tools')
    loadExtensionMock.mockResolvedValue({ name: 'DataApi DevTools' })
  })

  it('does not install extensions outside development mode', async () => {
    await (service as any).onReady()

    expect(installExtensionMock).not.toHaveBeenCalled()
    expect(loadExtensionMock).not.toHaveBeenCalled()
  })

  it('installs React and DataApi devtools in development mode', async () => {
    platformState.isDev = true

    await (service as any).onReady()

    expect(installExtensionMock).toHaveBeenCalledWith('react-devtools')
    expect(loadExtensionMock).toHaveBeenCalledWith('/mock/app.root.resources/devtools/data-api')
    expect(loggerMock.info).toHaveBeenCalledWith('Added Extension: React Developer Tools')
    expect(loggerMock.info).toHaveBeenCalledWith('Added Extension: DataApi DevTools')
  })

  it('logs install failures without throwing', async () => {
    platformState.isDev = true
    const reactError = new Error('react failed')
    const dataApiError = new Error('data api failed')
    installExtensionMock.mockRejectedValue(reactError)
    loadExtensionMock.mockRejectedValue(dataApiError)

    await expect((service as any).onReady()).resolves.toBeUndefined()

    expect(loggerMock.error).toHaveBeenCalledWith('Failed to install React Developer Tools extension', reactError)
    expect(loggerMock.error).toHaveBeenCalledWith('Failed to install DataApi DevTools extension', dataApiError)
  })
})
