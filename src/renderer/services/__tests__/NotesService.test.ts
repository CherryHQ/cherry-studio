import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = {
  ipcRequest: vi.fn(),
  validateNotesDirectory: vi.fn(),
  checkFileName: vi.fn(),
  mkdir: vi.fn()
}

vi.mock('@renderer/ipc', () => ({
  ipcApi: {
    request: (...args: unknown[]) => mocks.ipcRequest(...args)
  }
}))

const DEFAULT_PATH = '/default-notes'

let devicePath: string | null
let deviceReadFails: boolean
let stampedPaths: Array<string | undefined>

function stubWindowApi() {
  Object.assign(window, {
    api: {
      file: {
        validateNotesDirectory: mocks.validateNotesDirectory,
        checkFileName: mocks.checkFileName,
        mkdir: mocks.mkdir
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
  devicePath = null
  deviceReadFails = false
  stampedPaths = []
  mocks.ipcRequest.mockImplementation((route: string, input?: { path?: string }) => {
    if (route === 'app.get_info') return Promise.resolve({ notesPath: DEFAULT_PATH })
    if (route === 'file.notes.get_device_path') {
      return deviceReadFails ? Promise.reject(new Error('ipc down')) : Promise.resolve(devicePath)
    }
    if (route === 'file.notes.set_device_path') {
      stampedPaths.push(input?.path)
      return Promise.resolve(undefined)
    }
    return Promise.resolve(true)
  })
  mocks.validateNotesDirectory.mockResolvedValue(true)
  mocks.checkFileName.mockImplementation(async (_dir: string, name: string) => ({ safeName: name }))
  mocks.mkdir.mockResolvedValue(undefined)
})

describe('resolveNotesPath device path', () => {
  it('prefers this PC’s stamped path over a foreign synced pref', async () => {
    devicePath = 'D:\\Notes'
    mocks.validateNotesDirectory.mockImplementation(async (dir: string) => dir === 'D:/Notes')
    const { resolveNotesPath } = await loadService()

    const resolved = await resolveNotesPath('E:/OthersNotes')

    expect(resolved).toEqual({ path: 'D:/Notes', isFallback: false })
    expect(mocks.validateNotesDirectory).toHaveBeenCalledWith('D:/Notes')
  })

  it('keeps a nested folder under the stamped path instead of the workspace root', async () => {
    devicePath = 'D:\\Notes'
    const { resolveNotesPath } = await loadService()

    const resolved = await resolveNotesPath('D:/Notes/sub')

    expect(resolved).toEqual({ path: 'D:/Notes/sub', isFallback: false })
    expect(mocks.validateNotesDirectory).toHaveBeenCalledWith('D:/Notes/sub')
    expect(stampedPaths).toEqual([])
  })

  it('does not stamp a nested folder reached while the stamped path is stale', async () => {
    devicePath = '/stale-notes'
    mocks.validateNotesDirectory.mockImplementation(async (dir: string) => dir !== '/stale-notes')
    const { resolveNotesPath } = await loadService()

    // Creation calls resolve nested folders with adoption off — only the
    // workspace-root callers (init, reference tool) promise roots.
    const resolved = await resolveNotesPath('/custom-notes/sub', { adoptDevicePath: false })

    expect(resolved).toEqual({ path: '/custom-notes/sub', isFallback: false })
    expect(stampedPaths).toEqual([])
  })

  it('adopts a valid custom pref when nothing was stamped here yet', async () => {
    const { resolveNotesPath } = await loadService()

    const resolved = await resolveNotesPath('/custom-notes')

    expect(resolved).toEqual({ path: '/custom-notes', isFallback: false })
    expect(stampedPaths).toEqual(['/custom-notes'])
  })

  it('never stamps the default tree or its subfolders on a fresh install', async () => {
    const { resolveNotesPath } = await loadService()

    await expect(resolveNotesPath(DEFAULT_PATH)).resolves.toEqual({ path: DEFAULT_PATH, isFallback: false })
    await expect(resolveNotesPath(`${DEFAULT_PATH}/sub`)).resolves.toEqual({
      path: `${DEFAULT_PATH}/sub`,
      isFallback: false
    })
    expect(stampedPaths).toEqual([])
  })

  it('falls back to default for a missing pref path without stamping', async () => {
    mocks.validateNotesDirectory.mockResolvedValue(false)
    const { resolveNotesPath } = await loadService()

    const resolved = await resolveNotesPath('/gone-notes')

    expect(resolved).toEqual({ path: DEFAULT_PATH, isFallback: true })
    expect(stampedPaths).toEqual([])
  })

  it('heals a stale stamped path with the valid pref', async () => {
    devicePath = '/stale-notes'
    mocks.validateNotesDirectory.mockImplementation(async (dir: string) => dir !== '/stale-notes')
    const { resolveNotesPath } = await loadService()

    const resolved = await resolveNotesPath('/custom-notes')

    expect(resolved).toEqual({ path: '/custom-notes', isFallback: false })
    expect(stampedPaths).toEqual(['/custom-notes'])
  })

  it('never throws when the device sidecar cannot be read', async () => {
    deviceReadFails = true
    const { resolveNotesPath } = await loadService()

    const resolved = await resolveNotesPath('/custom-notes')

    expect(resolved).toEqual({ path: '/custom-notes', isFallback: false })
  })
})

describe('addDir device path', () => {
  it('creates inside the selected subfolder without redirecting or stamping', async () => {
    devicePath = 'D:\\Notes'
    const { addDir } = await loadService()

    const created = await addDir('sub2', 'D:/Notes/sub')

    expect(created).toEqual({ path: 'D:/Notes/sub/sub2', name: 'sub2' })
    expect(mocks.checkFileName).toHaveBeenCalledWith('D:/Notes/sub', 'sub2', false)
    expect(stampedPaths).toEqual([])
  })
})
