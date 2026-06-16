import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { getPathMock, getLogsDirMock } = vi.hoisted(() => ({
  getPathMock: vi.fn((key: string) => `/mock/${key}`),
  getLogsDirMock: vi.fn(() => '/mock/logs')
}))

vi.mock('@application', () => ({
  application: {
    getPath: getPathMock
  }
}))

vi.mock('@logger', () => ({
  loggerService: {
    getLogsDir: getLogsDirMock
  }
}))

vi.mock('@main/core/platform', () => ({
  isWin: true
}))

vi.mock('electron', () => ({
  app: {
    getVersion: vi.fn(() => '2.0.0'),
    isPackaged: true
  }
}))

import { appHandlers } from '../app'

const originalPortableExecutableDir = process.env.PORTABLE_EXECUTABLE_DIR

beforeEach(() => {
  vi.clearAllMocks()
  process.env.PORTABLE_EXECUTABLE_DIR = 'C:\\Portable'
})

afterEach(() => {
  process.env.PORTABLE_EXECUTABLE_DIR = originalPortableExecutableDir
})

describe('appHandlers', () => {
  it('get_info returns app metadata from application paths and Electron', async () => {
    const result = await appHandlers['app.get_info'](undefined, { senderId: 'w1' })

    expect(result).toEqual({
      version: '2.0.0',
      isPackaged: true,
      appPath: '/mock/app.root',
      filesPath: '/mock/feature.files.data',
      notesPath: '/mock/feature.notes.data',
      appDataPath: '/mock/app.userdata',
      resourcesPath: '/mock/app.root.resources',
      logsPath: '/mock/logs',
      arch: expect.any(String),
      isPortable: true,
      installPath: '/mock/app.install'
    })
    expect(getPathMock).toHaveBeenCalledWith('feature.notes.data')
    expect(getLogsDirMock).toHaveBeenCalledOnce()
  })
})
