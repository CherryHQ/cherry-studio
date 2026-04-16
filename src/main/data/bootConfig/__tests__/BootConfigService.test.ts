import fs from 'node:fs'

import { DefaultBootConfig } from '@shared/data/bootConfig/bootConfigSchemas'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('node:fs', async () => {
  const { createNodeFsMock } = await import('@test-helpers/mocks/nodeFsMock')
  return createNodeFsMock()
})

const mockFs = vi.mocked(fs)
const mockRenameSync = mockFs.renameSync

const CONFIG_PATH = '/mock/home/.cherrystudio/boot-config.json'
const TEMP_PATH = `${CONFIG_PATH}.tmp`

async function createService() {
  const { BootConfigService } = await import('../BootConfigService')
  return new BootConfigService()
}

describe('BootConfigService', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // ---------- loadSync ----------

  describe('loadSync', () => {
    it('uses defaults when config file does not exist', async () => {
      mockFs.existsSync.mockReturnValue(false)

      const service = await createService()

      expect(service.getAll()).toEqual(DefaultBootConfig)
      expect(service.hasLoadError()).toBe(false)
    })

    it('loads values from a valid JSON file', async () => {
      const stored = { 'app.disable_hardware_acceleration': true }
      mockFs.existsSync.mockReturnValue(true)
      mockFs.readFileSync.mockReturnValue(JSON.stringify(stored))

      const service = await createService()

      expect(service.get('app.disable_hardware_acceleration')).toBe(true)
      expect(service.hasLoadError()).toBe(false)
    })

    it('records a parse_error and uses defaults for corrupt JSON', async () => {
      mockFs.existsSync.mockReturnValue(true)
      mockFs.readFileSync.mockReturnValue('not-valid-json{{{')

      const service = await createService()

      expect(service.getAll()).toEqual(DefaultBootConfig)
      expect(service.hasLoadError()).toBe(true)

      const err = service.getLoadError()
      expect(err?.type).toBe('parse_error')
      expect(err?.filePath).toBe(CONFIG_PATH)
      expect(err?.rawContent).toBe('not-valid-json{{{')
    })

    it('records a read_error and uses defaults on file read failure', async () => {
      mockFs.existsSync.mockImplementation((p) => {
        if (p === CONFIG_PATH) throw new Error('EACCES: permission denied')
        return false
      })

      const service = await createService()

      expect(service.getAll()).toEqual(DefaultBootConfig)
      expect(service.hasLoadError()).toBe(true)

      const err = service.getLoadError()
      expect(err?.type).toBe('read_error')
      expect(err?.message).toContain('EACCES')
    })
  })

  // ---------- get / set ----------

  describe('get / set', () => {
    it('get returns the correct typed value', async () => {
      mockFs.existsSync.mockReturnValue(false)

      const service = await createService()

      const val: boolean = service.get('app.disable_hardware_acceleration')
      expect(val).toBe(DefaultBootConfig['app.disable_hardware_acceleration'])
    })

    it('set updates the value and schedules a debounced save', async () => {
      mockFs.existsSync.mockReturnValue(false)

      const service = await createService()
      service.set('app.disable_hardware_acceleration', true)

      expect(service.get('app.disable_hardware_acceleration')).toBe(true)

      // Save should not happen immediately
      expect(mockFs.writeFileSync).not.toHaveBeenCalled()

      // Advance past debounce (500 ms)
      vi.advanceTimersByTime(500)

      expect(mockFs.writeFileSync).toHaveBeenCalledWith(TEMP_PATH, expect.any(String), 'utf-8')
      expect(mockRenameSync).toHaveBeenCalledWith(TEMP_PATH, CONFIG_PATH)
    })
  })

  // ---------- flush ----------

  describe('flush', () => {
    it('cancels debounce and saves immediately', async () => {
      mockFs.existsSync.mockReturnValue(false)

      const service = await createService()
      service.set('app.disable_hardware_acceleration', true)

      // Flush before debounce fires
      service.flush()

      expect(mockFs.writeFileSync).toHaveBeenCalledTimes(1)
      expect(mockRenameSync).toHaveBeenCalledTimes(1)

      // Advancing timers should NOT trigger a second save
      vi.advanceTimersByTime(1000)
      expect(mockFs.writeFileSync).toHaveBeenCalledTimes(1)
    })

    it('is a no-op when there is no pending save', async () => {
      mockFs.existsSync.mockReturnValue(false)

      const service = await createService()
      service.flush()

      // No pending save, so no file write should occur
      expect(mockFs.writeFileSync).not.toHaveBeenCalled()
    })
  })

  // ---------- onChange ----------

  describe('onChange', () => {
    it('calls listener when value changes via set', async () => {
      mockFs.existsSync.mockReturnValue(false)

      const service = await createService()
      const listener = vi.fn()

      service.onChange('app.disable_hardware_acceleration', listener)
      service.set('app.disable_hardware_acceleration', true)

      expect(listener).toHaveBeenCalledTimes(1)
      expect(listener).toHaveBeenCalledWith({
        key: 'app.disable_hardware_acceleration',
        value: true,
        previousValue: false
      })
    })

    it('unsubscribe prevents further notifications', async () => {
      mockFs.existsSync.mockReturnValue(false)

      const service = await createService()
      const listener = vi.fn()

      const unsub = service.onChange('app.disable_hardware_acceleration', listener)
      unsub()

      service.set('app.disable_hardware_acceleration', true)
      expect(listener).not.toHaveBeenCalled()
    })

    it('handles listener errors without breaking other listeners', async () => {
      mockFs.existsSync.mockReturnValue(false)

      const service = await createService()
      const badListener = vi.fn(() => {
        throw new Error('boom')
      })
      const goodListener = vi.fn()

      service.onChange('app.disable_hardware_acceleration', badListener)
      service.onChange('app.disable_hardware_acceleration', goodListener)

      service.set('app.disable_hardware_acceleration', true)

      expect(badListener).toHaveBeenCalledTimes(1)
      expect(goodListener).toHaveBeenCalledTimes(1)
    })
  })

  // ---------- mergeDefaults ----------

  describe('mergeDefaults (via loadSync)', () => {
    it('fills missing keys from defaults', async () => {
      // Stored config has no keys — defaults should fill in
      mockFs.existsSync.mockReturnValue(true)
      mockFs.readFileSync.mockReturnValue(JSON.stringify({}))

      const service = await createService()

      expect(service.getAll()).toEqual(DefaultBootConfig)
    })

    it('ignores extra keys not in schema', async () => {
      const stored = {
        'app.disable_hardware_acceleration': true,
        'unknown.key': 42
      }
      mockFs.existsSync.mockReturnValue(true)
      mockFs.readFileSync.mockReturnValue(JSON.stringify(stored))

      const service = await createService()

      expect(service.get('app.disable_hardware_acceleration')).toBe(true)
      expect((service.getAll() as unknown as Record<string, unknown>)['unknown.key']).toBeUndefined()
    })

    it('returns defaults for non-object input (array)', async () => {
      mockFs.existsSync.mockReturnValue(true)
      mockFs.readFileSync.mockReturnValue(JSON.stringify([1, 2, 3]))

      const service = await createService()

      expect(service.getAll()).toEqual(DefaultBootConfig)
    })

    it('returns defaults for null input', async () => {
      mockFs.existsSync.mockReturnValue(true)
      mockFs.readFileSync.mockReturnValue(JSON.stringify(null))

      const service = await createService()

      expect(service.getAll()).toEqual(DefaultBootConfig)
    })
  })

  // ---------- atomic save ----------

  describe('atomic save', () => {
    it('writes to a temp file then renames', async () => {
      mockFs.existsSync.mockReturnValue(false)

      const service = await createService()
      service.set('app.disable_hardware_acceleration', true)
      service.flush()

      const writeOrder = mockFs.writeFileSync.mock.invocationCallOrder[0]
      const renameOrder = mockRenameSync.mock.invocationCallOrder[0]
      expect(writeOrder).toBeLessThan(renameOrder)

      expect(mockFs.writeFileSync).toHaveBeenCalledWith(TEMP_PATH, expect.any(String), 'utf-8')
      expect(mockRenameSync).toHaveBeenCalledWith(TEMP_PATH, CONFIG_PATH)
    })

    it('creates parent directory if it does not exist', async () => {
      // First call in loadSync (file doesn't exist), subsequent calls in saveSync
      mockFs.existsSync.mockReturnValue(false)

      const service = await createService()
      service.set('app.disable_hardware_acceleration', true)
      service.flush()

      expect(mockFs.mkdirSync).toHaveBeenCalledWith(expect.any(String), { recursive: true })
    })

    it('does not throw when save fails', async () => {
      mockFs.existsSync.mockReturnValue(false)
      mockFs.writeFileSync.mockImplementation(() => {
        throw new Error('ENOSPC')
      })

      const service = await createService()

      // Should not throw
      expect(() => service.flush()).not.toThrow()
    })
  })

  // ---------- differential save ----------

  describe('differential save', () => {
    it('only writes keys that differ from defaults', async () => {
      mockFs.existsSync.mockReturnValue(false)

      const service = await createService()
      service.set('app.disable_hardware_acceleration', true)
      service.flush()

      const written = JSON.parse(mockFs.writeFileSync.mock.calls[0][1] as string)
      expect(written).toEqual({ 'app.disable_hardware_acceleration': true })
    })

    it('does not write file when value equals default', async () => {
      mockFs.existsSync.mockReturnValue(false)

      const service = await createService()
      service.set('app.disable_hardware_acceleration', false) // same as default
      service.flush()

      expect(mockFs.writeFileSync).not.toHaveBeenCalled()
    })

    it('deletes file when all values are reset to defaults', async () => {
      mockFs.existsSync.mockReturnValue(false)

      const service = await createService()
      service.set('app.disable_hardware_acceleration', true)
      service.flush()

      // File now exists
      mockFs.existsSync.mockReturnValue(true)
      service.set('app.disable_hardware_acceleration', false) // back to default
      service.flush()

      expect(mockFs.unlinkSync).toHaveBeenCalledWith(CONFIG_PATH)
    })
  })

  // ---------- reset ----------

  describe('reset', () => {
    it('restores defaults and deletes config file', async () => {
      const stored = { 'app.disable_hardware_acceleration': true }
      mockFs.existsSync.mockReturnValue(true)
      mockFs.readFileSync.mockReturnValue(JSON.stringify(stored))

      const service = await createService()
      expect(service.get('app.disable_hardware_acceleration')).toBe(true)

      service.reset()

      expect(service.getAll()).toEqual(DefaultBootConfig)
      expect(mockFs.unlinkSync).toHaveBeenCalledWith(CONFIG_PATH)
      expect(service.hasLoadError()).toBe(false)
    })

    it('notifies listeners on reset', async () => {
      mockFs.existsSync.mockReturnValue(false)

      const service = await createService()
      const listener = vi.fn()
      service.onChange('app.disable_hardware_acceleration', listener)

      service.set('app.disable_hardware_acceleration', true)
      listener.mockClear()

      service.reset()

      expect(listener).toHaveBeenCalledWith({
        key: 'app.disable_hardware_acceleration',
        value: DefaultBootConfig['app.disable_hardware_acceleration'],
        previousValue: true
      })
    })
  })

  // ---------- clearLoadError ----------

  describe('clearLoadError', () => {
    it('clears a previously recorded load error', async () => {
      mockFs.existsSync.mockReturnValue(true)
      mockFs.readFileSync.mockReturnValue('bad json')

      const service = await createService()
      expect(service.hasLoadError()).toBe(true)

      service.clearLoadError()
      expect(service.hasLoadError()).toBe(false)
      expect(service.getLoadError()).toBeNull()
    })
  })

  // ---------- getFilePath ----------

  describe('getFilePath', () => {
    it('returns the expected path', async () => {
      mockFs.existsSync.mockReturnValue(false)

      const service = await createService()

      expect(service.getFilePath()).toBe(CONFIG_PATH)
    })
  })

  // ---------- debounce coalescing ----------

  describe('debounce coalescing', () => {
    it('multiple rapid sets produce only one save', async () => {
      mockFs.existsSync.mockReturnValue(false)

      const service = await createService()

      service.set('app.disable_hardware_acceleration', true)
      service.set('app.disable_hardware_acceleration', false)
      service.set('app.disable_hardware_acceleration', true)

      vi.advanceTimersByTime(500)

      expect(mockFs.writeFileSync).toHaveBeenCalledTimes(1)

      const written = JSON.parse(mockFs.writeFileSync.mock.calls[0][1] as string)
      expect(written['app.disable_hardware_acceleration']).toBe(true)
    })
  })
})
