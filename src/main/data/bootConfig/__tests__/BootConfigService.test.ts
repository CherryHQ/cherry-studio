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

      // Advance past debounce (350 ms)
      vi.advanceTimersByTime(350)

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

  // ---------- persist (strict save) ----------

  describe('persist', () => {
    it('throws when writeFileSync fails', async () => {
      mockFs.existsSync.mockReturnValue(false)

      const service = await createService()
      service.set('app.disable_hardware_acceleration', true)

      mockFs.writeFileSync.mockImplementationOnce(() => {
        throw new Error('ENOSPC: no space left on device')
      })

      expect(() => service.persist()).toThrow('ENOSPC')
    })

    it('throws when renameSync fails', async () => {
      mockFs.existsSync.mockReturnValue(false)

      const service = await createService()
      service.set('app.disable_hardware_acceleration', true)

      mockRenameSync.mockImplementationOnce(() => {
        throw new Error('EXDEV: cross-device link not permitted')
      })

      expect(() => service.persist()).toThrow('EXDEV')
    })

    it('throws when unlink fails with a non-ENOENT error, even if existsSync reports the file absent', async () => {
      // existsSync stays false throughout: it must NOT gate the delete (existsSync
      // folds stat/permission errors into `false`, which would mask a real file and
      // let persist() falsely succeed while stale config stays on disk).
      mockFs.existsSync.mockReturnValue(false)

      const service = await createService()
      service.set('app.disable_hardware_acceleration', true)
      service.persist()

      // Resetting the value to default triggers the delete path.
      mockFs.unlinkSync.mockImplementationOnce(() => {
        throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' })
      })
      service.set('app.disable_hardware_acceleration', false)

      expect(() => service.persist()).toThrow('EACCES')
    })

    it('treats an ENOENT unlink (file already gone) as success', async () => {
      mockFs.existsSync.mockReturnValue(false)

      const service = await createService()
      service.set('app.disable_hardware_acceleration', true)
      service.persist()

      mockFs.unlinkSync.mockImplementationOnce(() => {
        throw Object.assign(new Error('ENOENT: no such file or directory'), { code: 'ENOENT' })
      })
      service.set('app.disable_hardware_acceleration', false)

      // ENOENT means the desired state (no file) already holds → not an error.
      expect(() => service.persist()).not.toThrow()
      expect(mockFs.unlinkSync).toHaveBeenCalledTimes(1)
    })

    it('retains dirty after a non-ENOENT unlink failure so a later persist retries', async () => {
      mockFs.existsSync.mockReturnValue(false)

      const service = await createService()
      service.set('app.disable_hardware_acceleration', true)
      service.persist()

      mockFs.unlinkSync.mockImplementationOnce(() => {
        throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' })
      })
      service.set('app.disable_hardware_acceleration', false)

      expect(() => service.persist()).toThrow('EACCES')

      // dirty retained → retry deletes successfully.
      service.persist()
      expect(mockFs.unlinkSync).toHaveBeenCalledTimes(2)
    })

    it('is a no-op when nothing is dirty', async () => {
      mockFs.existsSync.mockReturnValue(false)

      const service = await createService()

      expect(() => service.persist()).not.toThrow()
      expect(mockFs.writeFileSync).not.toHaveBeenCalled()
    })

    it('cancels the pending debounce timer so no duplicate save fires', async () => {
      mockFs.existsSync.mockReturnValue(false)

      const service = await createService()
      service.set('app.disable_hardware_acceleration', true)
      service.persist()

      expect(mockFs.writeFileSync).toHaveBeenCalledTimes(1)

      vi.advanceTimersByTime(1000)
      expect(mockFs.writeFileSync).toHaveBeenCalledTimes(1)
    })
  })

  // ---------- dirty state and retry ----------

  describe('dirty state and retry', () => {
    it('retains dirty after a failed flush so a later flush retries and writes', async () => {
      mockFs.existsSync.mockReturnValue(false)

      const service = await createService()
      service.set('app.disable_hardware_acceleration', true)

      // First attempt fails; flush swallows the error but must keep the state dirty.
      mockFs.writeFileSync.mockImplementationOnce(() => {
        throw new Error('ENOSPC')
      })
      service.flush()
      expect(mockFs.writeFileSync).toHaveBeenCalledTimes(1)
      expect(mockRenameSync).not.toHaveBeenCalled()

      // Second flush retries and, with fs healthy again, persists successfully.
      service.flush()
      expect(mockFs.writeFileSync).toHaveBeenCalledTimes(2)
      expect(mockRenameSync).toHaveBeenCalledTimes(1)
    })

    it('retains dirty after a failed background save so a later flush retries', async () => {
      mockFs.existsSync.mockReturnValue(false)

      const service = await createService()
      service.set('app.disable_hardware_acceleration', true)

      // The debounced auto-save fires and fails — it must not throw out of the
      // timer callback, and the state must stay dirty for a later retry.
      mockFs.writeFileSync.mockImplementationOnce(() => {
        throw new Error('ENOSPC')
      })
      expect(() => vi.advanceTimersByTime(350)).not.toThrow()
      expect(mockFs.writeFileSync).toHaveBeenCalledTimes(1)

      service.flush()
      expect(mockFs.writeFileSync).toHaveBeenCalledTimes(2)
      expect(mockRenameSync).toHaveBeenCalledTimes(1)
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

    it('returns defaults and records validation_error for non-object input (array)', async () => {
      mockFs.existsSync.mockReturnValue(true)
      mockFs.readFileSync.mockReturnValue(JSON.stringify([1, 2, 3]))

      const service = await createService()

      expect(service.getAll()).toEqual(DefaultBootConfig)
      expect(service.getLoadError()?.type).toBe('validation_error')
    })

    it('returns defaults and records validation_error for null input', async () => {
      mockFs.existsSync.mockReturnValue(true)
      mockFs.readFileSync.mockReturnValue(JSON.stringify(null))

      const service = await createService()

      expect(service.getAll()).toEqual(DefaultBootConfig)
      expect(service.getLoadError()?.type).toBe('validation_error')
    })
  })

  // ---------- schema validation on load ----------

  describe('schema validation (via loadSync)', () => {
    it('resets a wrong-typed boolean to default and records validation_error', async () => {
      const stored = { 'app.disable_hardware_acceleration': 'yes' }
      mockFs.existsSync.mockReturnValue(true)
      mockFs.readFileSync.mockReturnValue(JSON.stringify(stored))

      const service = await createService()

      expect(service.get('app.disable_hardware_acceleration')).toBe(false)

      const err = service.getLoadError()
      expect(err?.type).toBe('validation_error')
      expect(err?.invalidKeys).toEqual(['app.disable_hardware_acceleration'])
      expect(err?.filePath).toBe(CONFIG_PATH)
    })

    it('keeps valid keys while resetting only the invalid ones', async () => {
      const stored = {
        'app.disable_hardware_acceleration': true,
        'app.user_data_path': 42
      }
      mockFs.existsSync.mockReturnValue(true)
      mockFs.readFileSync.mockReturnValue(JSON.stringify(stored))

      const service = await createService()

      expect(service.get('app.disable_hardware_acceleration')).toBe(true)
      expect(service.get('app.user_data_path')).toEqual({})
      expect(service.getLoadError()?.invalidKeys).toEqual(['app.user_data_path'])
    })

    it('rejects a user_data_path record with non-string values', async () => {
      const stored = { 'app.user_data_path': { '/Applications/App': 123 } }
      mockFs.existsSync.mockReturnValue(true)
      mockFs.readFileSync.mockReturnValue(JSON.stringify(stored))

      const service = await createService()

      expect(service.get('app.user_data_path')).toEqual({})
      expect(service.getLoadError()?.invalidKeys).toEqual(['app.user_data_path'])
    })

    it('rejects a pending relocation missing from/to', async () => {
      const stored = { 'temp.user_data_relocation': { status: 'pending' } }
      mockFs.existsSync.mockReturnValue(true)
      mockFs.readFileSync.mockReturnValue(JSON.stringify(stored))

      const service = await createService()

      expect(service.get('temp.user_data_relocation')).toBeNull()
      expect(service.getLoadError()?.invalidKeys).toEqual(['temp.user_data_relocation'])
    })

    it('rejects a relocation with an unknown status', async () => {
      const stored = { 'temp.user_data_relocation': { status: 'running', from: '/a', to: '/b' } }
      mockFs.existsSync.mockReturnValue(true)
      mockFs.readFileSync.mockReturnValue(JSON.stringify(stored))

      const service = await createService()

      expect(service.get('temp.user_data_relocation')).toBeNull()
      expect(service.getLoadError()?.invalidKeys).toEqual(['temp.user_data_relocation'])
    })

    it('accepts a well-formed pending relocation without recording an error', async () => {
      const relocation = {
        status: 'pending',
        taskId: '11111111-1111-4111-8111-111111111111',
        from: '/a',
        to: '/b',
        copy: true
      }
      const stored = { 'temp.user_data_relocation': relocation }
      mockFs.existsSync.mockReturnValue(true)
      mockFs.readFileSync.mockReturnValue(JSON.stringify(stored))

      const service = await createService()

      expect(service.get('temp.user_data_relocation')).toEqual(relocation)
      expect(service.hasLoadError()).toBe(false)
    })
  })

  // ---------- schema validation on set ----------

  describe('schema validation (via set)', () => {
    it('throws on an invalid value and leaves state, save, and listeners untouched', async () => {
      mockFs.existsSync.mockReturnValue(false)

      const service = await createService()
      const listener = vi.fn()
      service.onChange('app.disable_hardware_acceleration', listener)

      expect(() => service.set('app.disable_hardware_acceleration', 'yes' as never)).toThrow(
        'Invalid boot config value'
      )

      expect(service.get('app.disable_hardware_acceleration')).toBe(false)
      expect(listener).not.toHaveBeenCalled()

      vi.advanceTimersByTime(350)
      expect(mockFs.writeFileSync).not.toHaveBeenCalled()
    })

    it('throws on a malformed relocation object', async () => {
      mockFs.existsSync.mockReturnValue(false)

      const service = await createService()

      expect(() => service.set('temp.user_data_relocation', { status: 'pending' } as never)).toThrow(
        'Invalid boot config value'
      )
      expect(service.get('temp.user_data_relocation')).toBeNull()
    })

    it('accepts a valid relocation object', async () => {
      mockFs.existsSync.mockReturnValue(false)

      const service = await createService()
      const relocation = {
        status: 'pending' as const,
        taskId: '11111111-1111-4111-8111-111111111111',
        from: '/a',
        to: '/b',
        copy: true
      }
      service.set('temp.user_data_relocation', relocation)

      expect(service.get('temp.user_data_relocation')).toEqual(relocation)
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
      // First call in loadSync (file doesn't exist), subsequent calls in writeToDisk
      mockFs.existsSync.mockReturnValue(false)

      const service = await createService()
      service.set('app.disable_hardware_acceleration', true)
      service.flush()

      expect(mockFs.mkdirSync).toHaveBeenCalledWith(expect.any(String), { recursive: true })
    })

    it('does not throw when save fails', async () => {
      mockFs.existsSync.mockReturnValue(false)
      mockFs.writeFileSync.mockImplementationOnce(() => {
        throw new Error('ENOSPC')
      })

      const service = await createService()
      service.set('app.disable_hardware_acceleration', true)

      // flush is best-effort: it swallows the write failure instead of throwing.
      expect(() => service.flush()).not.toThrow()
      expect(mockFs.writeFileSync).toHaveBeenCalledTimes(1)
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

  // ---------- repair ----------

  describe('repair', () => {
    it('persists valid keys, drops invalid ones, and clears the load error', async () => {
      const stored = {
        'app.disable_hardware_acceleration': 'yes',
        'app.user_data_path': { '/exe': '/data' }
      }
      mockFs.existsSync.mockReturnValue(true)
      mockFs.readFileSync.mockReturnValue(JSON.stringify(stored))

      const service = await createService()
      expect(service.getLoadError()?.type).toBe('validation_error')

      service.repair()

      const written = JSON.parse(mockFs.writeFileSync.mock.calls[0][1] as string)
      expect(written).toEqual({ 'app.user_data_path': { '/exe': '/data' } })
      expect(service.hasLoadError()).toBe(false)
    })

    it('deletes the file when repair leaves only defaults', async () => {
      const stored = { 'app.disable_hardware_acceleration': 'yes' }
      mockFs.existsSync.mockReturnValue(true)
      mockFs.readFileSync.mockReturnValue(JSON.stringify(stored))

      const service = await createService()
      service.repair()

      expect(mockFs.writeFileSync).not.toHaveBeenCalled()
      expect(mockFs.unlinkSync).toHaveBeenCalledWith(CONFIG_PATH)
      expect(service.hasLoadError()).toBe(false)
    })

    it('throws on write failure, retaining the load error for a later retry', async () => {
      const stored = {
        'app.disable_hardware_acceleration': 'yes',
        'app.user_data_path': { '/exe': '/data' }
      }
      mockFs.existsSync.mockReturnValue(true)
      mockFs.readFileSync.mockReturnValue(JSON.stringify(stored))

      const service = await createService()

      mockFs.writeFileSync.mockImplementationOnce(() => {
        throw new Error('ENOSPC: no space left on device')
      })
      expect(() => service.repair()).toThrow('ENOSPC')
      expect(service.getLoadError()?.type).toBe('validation_error')

      // A later repair retries the write and succeeds.
      service.repair()
      expect(mockRenameSync).toHaveBeenCalledTimes(1)
      expect(service.hasLoadError()).toBe(false)
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

      vi.advanceTimersByTime(350)

      expect(mockFs.writeFileSync).toHaveBeenCalledTimes(1)

      const written = JSON.parse(mockFs.writeFileSync.mock.calls[0][1] as string)
      expect(written['app.disable_hardware_acceleration']).toBe(true)
    })
  })
})
