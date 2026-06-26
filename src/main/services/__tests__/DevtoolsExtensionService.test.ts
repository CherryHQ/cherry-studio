import { getConditions } from '@main/core/lifecycle'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { applicationMock, loggerMock, loadExtensionMock, installExtensionMock } = vi.hoisted(() => {
  const applicationMock = {
    getPath: vi.fn((key: string) => `/mock/${key}`)
  }
  const loggerMock = {
    error: vi.fn(),
    info: vi.fn()
  }
  const loadExtensionMock = vi.fn()
  const installExtensionMock = vi.fn()
  return { applicationMock, loggerMock, loadExtensionMock, installExtensionMock }
})

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
    vi.clearAllMocks()
    installExtensionMock.mockResolvedValue('React Developer Tools')
    loadExtensionMock.mockResolvedValue({ name: 'DataApi DevTools' })
  })

  it('is conditional on development mode', () => {
    const conditions = getConditions(DevtoolsExtensionService)

    expect(conditions).toHaveLength(1)
    expect(conditions?.[0].description).toBe('requires env NODE_ENV=development')
    expect(conditions?.[0].matches({ platform: 'darwin', arch: 'arm64', cpuModel: 'Apple M', env: {} })).toBe(false)
    expect(
      conditions?.[0].matches({
        platform: 'darwin',
        arch: 'arm64',
        cpuModel: 'Apple M',
        env: { NODE_ENV: 'development' }
      })
    ).toBe(true)
  })

  it('installs React and DataApi devtools', async () => {
    await (service as any).onReady()

    expect(installExtensionMock).toHaveBeenCalledWith('react-devtools')
    expect(loadExtensionMock).toHaveBeenCalledWith('/mock/app.root.resources/devtools/data-api')
    expect(loggerMock.info).toHaveBeenCalledWith('Added Extension: React Developer Tools')
    expect(loggerMock.info).toHaveBeenCalledWith('Added Extension: DataApi DevTools')
  })

  it('logs install failures without throwing', async () => {
    const reactError = new Error('react failed')
    const dataApiError = new Error('data api failed')
    installExtensionMock.mockRejectedValue(reactError)
    loadExtensionMock.mockRejectedValue(dataApiError)

    await expect((service as any).onReady()).resolves.toBeUndefined()

    expect(loggerMock.error).toHaveBeenCalledWith('Failed to install React Developer Tools extension', reactError)
    expect(loggerMock.error).toHaveBeenCalledWith('Failed to install DataApi DevTools extension', dataApiError)
  })
})
