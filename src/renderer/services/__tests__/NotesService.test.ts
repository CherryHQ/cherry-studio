import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = {
  ipcRequest: vi.fn(),
  validateNotesDirectory: vi.fn(),
  getDeviceNotesPath: vi.fn(),
  setDeviceNotesPath: vi.fn()
}

vi.mock('@renderer/ipc', () => ({
  ipcApi: {
    request: (...args: unknown[]) => mocks.ipcRequest(...args)
  }
}))

const DEFAULT_PATH = '/default-notes'

function stubWindowApi() {
  Object.assign(window, {
    api: {
      file: {
        validateNotesDirectory: mocks.validateNotesDirectory,
        getDeviceNotesPath: mocks.getDeviceNotesPath,
        setDeviceNotesPath: mocks.setDeviceNotesPath
      }
    }
  })
}

async function loadService() {
  vi.resetModules()
  stubWindowApi()
  return import('../NotesService')
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.ipcRequest.mockImplementation((route: string) => {
    if (route === 'app.get_info') return Promise.resolve({ notesPath: DEFAULT_PATH })
    return Promise.resolve(true)
  })
  mocks.getDeviceNotesPath.mockResolvedValue(null)
  mocks.setDeviceNotesPath.mockResolvedValue(undefined)
})

describe('resolveNotesPath device path', () => {
  it('prefers this PC’s stamped path over a foreign synced pref', async () => {
    mocks.getDeviceNotesPath.mockResolvedValue('D:\\Notes')
    mocks.validateNotesDirectory.mockImplementation(async (dir: string) => dir === 'D:/Notes')
    const { resolveNotesPath } = await loadService()

    const resolved = await resolveNotesPath('E:/OthersNotes')

    expect(resolved).toEqual({ path: 'D:/Notes', isFallback: false })
    expect(mocks.validateNotesDirectory).toHaveBeenCalledWith('D:/Notes')
  })

  it('adopts a valid custom pref when nothing was stamped here yet', async () => {
    mocks.validateNotesDirectory.mockResolvedValue(true)
    const { resolveNotesPath } = await loadService()

    const resolved = await resolveNotesPath('/custom-notes')

    expect(resolved).toEqual({ path: '/custom-notes', isFallback: false })
    expect(mocks.setDeviceNotesPath).toHaveBeenCalledWith('/custom-notes')
  })

  it('falls back to default for a missing pref path without stamping', async () => {
    mocks.validateNotesDirectory.mockResolvedValue(false)
    const { resolveNotesPath } = await loadService()

    const resolved = await resolveNotesPath('/gone-notes')

    expect(resolved).toEqual({ path: DEFAULT_PATH, isFallback: true })
    expect(mocks.setDeviceNotesPath).not.toHaveBeenCalled()
  })

  it('ignores a stale stamped path and uses the valid pref', async () => {
    mocks.getDeviceNotesPath.mockResolvedValue('/stale-notes')
    mocks.validateNotesDirectory.mockImplementation(async (dir: string) => dir !== '/stale-notes')
    const { resolveNotesPath } = await loadService()

    const resolved = await resolveNotesPath('/custom-notes')

    expect(resolved).toEqual({ path: '/custom-notes', isFallback: false })
  })

  it('never throws when the device sidecar cannot be read', async () => {
    mocks.getDeviceNotesPath.mockRejectedValue(new Error('ipc down'))
    mocks.validateNotesDirectory.mockResolvedValue(true)
    const { resolveNotesPath } = await loadService()

    const resolved = await resolveNotesPath('/custom-notes')

    expect(resolved).toEqual({ path: '/custom-notes', isFallback: false })
  })
})
