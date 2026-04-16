import fs from 'node:fs'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('node:fs', async () => {
  const { createNodeFsMock } = await import('@test-helpers/mocks/nodeFsMock')
  return createNodeFsMock()
})

const mockFs = vi.mocked(fs)

const CONFIG_PATH = '/mock/home/.cherrystudio/config/config.json'
// tests/main.setup.ts mocks app.getPath() to only handle 'userData' / 'temp' /
// 'logs' explicitly; everything else (including 'exe') falls through to '/mock/unknown'.
const MOCK_EXE = '/mock/unknown'

async function createReader() {
  const { LegacyHomeConfigReader } = await import('../LegacyHomeConfigReader')
  return new LegacyHomeConfigReader(CONFIG_PATH)
}

describe('LegacyHomeConfigReader', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('null return cases', () => {
    it('returns null when the file does not exist', async () => {
      mockFs.existsSync.mockReturnValue(false)

      const reader = await createReader()

      expect(reader.getUserDataPath()).toBeNull()
      expect(mockFs.existsSync).toHaveBeenCalledWith(CONFIG_PATH)
    })

    it('returns null when fs read throws (permission, etc.)', async () => {
      mockFs.existsSync.mockReturnValue(true)
      mockFs.readFileSync.mockImplementation(() => {
        throw new Error('EACCES: permission denied')
      })

      const reader = await createReader()

      expect(reader.getUserDataPath()).toBeNull()
    })

    it('returns null when JSON parsing fails', async () => {
      mockFs.existsSync.mockReturnValue(true)
      mockFs.readFileSync.mockReturnValue('not-valid-json{{{')

      const reader = await createReader()

      expect(reader.getUserDataPath()).toBeNull()
    })

    it('returns null when the root JSON is not an object', async () => {
      mockFs.existsSync.mockReturnValue(true)
      mockFs.readFileSync.mockReturnValue(JSON.stringify([1, 2, 3]))

      const reader = await createReader()

      expect(reader.getUserDataPath()).toBeNull()
    })

    it('returns null when appDataPath field is missing', async () => {
      mockFs.existsSync.mockReturnValue(true)
      mockFs.readFileSync.mockReturnValue(JSON.stringify({ somethingElse: 'foo' }))

      const reader = await createReader()

      expect(reader.getUserDataPath()).toBeNull()
    })

    it('returns null when appDataPath is of an unexpected type (number)', async () => {
      mockFs.existsSync.mockReturnValue(true)
      mockFs.readFileSync.mockReturnValue(JSON.stringify({ appDataPath: 42 }))

      const reader = await createReader()

      expect(reader.getUserDataPath()).toBeNull()
    })

    it('returns null when appDataPath is an empty array (C1: must NOT return {})', async () => {
      mockFs.existsSync.mockReturnValue(true)
      mockFs.readFileSync.mockReturnValue(JSON.stringify({ appDataPath: [] }))

      const reader = await createReader()

      expect(reader.getUserDataPath()).toBeNull()
    })

    it('returns null when all array entries are invalid (missing fields)', async () => {
      mockFs.existsSync.mockReturnValue(true)
      mockFs.readFileSync.mockReturnValue(
        JSON.stringify({
          appDataPath: [{}, { executablePath: '/foo' /* missing dataPath */ }, { dataPath: '/bar' /* missing exe */ }]
        })
      )

      const reader = await createReader()

      expect(reader.getUserDataPath()).toBeNull()
    })

    it('returns null when appDataPath is an empty legacy string', async () => {
      mockFs.existsSync.mockReturnValue(true)
      mockFs.readFileSync.mockReturnValue(JSON.stringify({ appDataPath: '' }))

      const reader = await createReader()

      expect(reader.getUserDataPath()).toBeNull()
    })
  })

  describe('record return cases', () => {
    it('wraps a legacy string value under the current exe path', async () => {
      mockFs.existsSync.mockReturnValue(true)
      mockFs.readFileSync.mockReturnValue(JSON.stringify({ appDataPath: '/Volumes/External/Data' }))

      const reader = await createReader()

      expect(reader.getUserDataPath()).toEqual({ [MOCK_EXE]: '/Volumes/External/Data' })
    })

    it('converts an array of valid entries into a record', async () => {
      mockFs.existsSync.mockReturnValue(true)
      mockFs.readFileSync.mockReturnValue(
        JSON.stringify({
          appDataPath: [
            { executablePath: '/Applications/Cherry Studio.app/exe', dataPath: '/Volumes/Ext1/Data' },
            { executablePath: '/Applications/Cherry Studio Dev.app/exe', dataPath: '/Volumes/Ext2/DevData' }
          ]
        })
      )

      const reader = await createReader()

      expect(reader.getUserDataPath()).toEqual({
        '/Applications/Cherry Studio.app/exe': '/Volumes/Ext1/Data',
        '/Applications/Cherry Studio Dev.app/exe': '/Volumes/Ext2/DevData'
      })
    })

    it('filters out invalid entries from a mixed array', async () => {
      mockFs.existsSync.mockReturnValue(true)
      mockFs.readFileSync.mockReturnValue(
        JSON.stringify({
          appDataPath: [
            { executablePath: '/valid/exe', dataPath: '/valid/data' },
            { executablePath: '/no-data/exe' }, // missing dataPath
            { dataPath: '/no-exe/data' }, // missing executablePath
            { executablePath: '', dataPath: '/empty-exe/data' }, // empty string
            { executablePath: '/another/valid/exe', dataPath: '/another/valid/data' }
          ]
        })
      )

      const reader = await createReader()

      expect(reader.getUserDataPath()).toEqual({
        '/valid/exe': '/valid/data',
        '/another/valid/exe': '/another/valid/data'
      })
    })
  })
})
