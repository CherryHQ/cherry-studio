import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ResolvedNotesPath } from '../NotesService'

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  warn: vi.fn()
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({ warn: mocks.warn })
  }
}))

vi.mock('@renderer/ipc', () => ({
  ipcApi: {
    request: (...args: unknown[]) => mocks.request(...args)
  }
}))

vi.mock('@renderer/utils/file', () => ({
  getFileDirectory: vi.fn()
}))

let resolveNotesPath: (parentPath: string) => Promise<ResolvedNotesPath>

describe('resolveNotesPath', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    vi.resetModules()
    mocks.request.mockImplementation((channel: string) => {
      if (channel === 'app.get_info') return Promise.resolve({ notesPath: '/default-notes' })
      throw new Error(`Unexpected IPC route: ${channel}`)
    })
    ;({ resolveNotesPath } = await import('../NotesService'))
  })

  it('keeps a valid configured Notes path through the typed file route', async () => {
    mocks.request.mockImplementation((channel: string) => {
      if (channel === 'app.get_info') return Promise.resolve({ notesPath: '/default-notes' })
      if (channel === 'file.validate_notes_directory') return Promise.resolve(true)
      throw new Error(`Unexpected IPC route: ${channel}`)
    })

    await expect(resolveNotesPath('/configured-notes')).resolves.toEqual({
      path: '/configured-notes',
      isFallback: false
    })
    expect(mocks.request).toHaveBeenNthCalledWith(1, 'app.get_info')
    expect(mocks.request).toHaveBeenNthCalledWith(2, 'file.validate_notes_directory', '/configured-notes')
  })

  it('falls back to the default Notes directory when typed validation rejects a configured path', async () => {
    mocks.request.mockImplementation((channel: string) => {
      if (channel === 'app.get_info') return Promise.resolve({ notesPath: '/default-notes' })
      if (channel === 'file.validate_notes_directory') return Promise.resolve(false)
      throw new Error(`Unexpected IPC route: ${channel}`)
    })

    await expect(resolveNotesPath('/invalid-notes')).resolves.toEqual({
      path: '/default-notes',
      isFallback: true
    })
    expect(mocks.request).toHaveBeenNthCalledWith(2, 'file.validate_notes_directory', '/invalid-notes')
  })
})
