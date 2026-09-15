import { beforeEach, describe, expect, it, vi } from 'vitest'

import { MIGRATION_LOCAL_STORAGE_KEYS, MigrationIpcChannels } from '@shared/data/migration/v2/types'

import { LocalStorageExporter } from '../LocalStorageExporter'

const invoke = vi.fn()

describe('LocalStorageExporter', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
    invoke.mockResolvedValue(true)
    ;(window as unknown as { electron: { ipcRenderer: { invoke: typeof invoke } } }).electron = {
      ipcRenderer: { invoke }
    }
  })

  it('exports only migration-owned keys and excludes the Redux persist blob', async () => {
    localStorage.setItem(MIGRATION_LOCAL_STORAGE_KEYS[0], 'true')
    localStorage.setItem('persist:cherry-studio', 'x'.repeat(1024 * 1024))
    localStorage.setItem('unrelated', 'secret')

    const exporter = new LocalStorageExporter('/export/local')
    await exporter.export()

    const text = invoke.mock.calls
      .filter((call) => call[0] === MigrationIpcChannels.WriteExportFile)
      .map((call) => call[3])
      .join('')
    expect(JSON.parse(text)).toEqual([{ key: MIGRATION_LOCAL_STORAGE_KEYS[0], value: true }])
    expect(exporter.getEntryCount()).toBe(1)
  })

  it('resets its count when the same exporter is rerun', async () => {
    localStorage.setItem(MIGRATION_LOCAL_STORAGE_KEYS[0], 'not-json')
    const exporter = new LocalStorageExporter('/export/local')

    await exporter.export()
    invoke.mockClear()
    await exporter.export()

    const text = invoke.mock.calls.map((call) => call[3]).join('')
    expect(JSON.parse(text)).toEqual([{ key: MIGRATION_LOCAL_STORAGE_KEYS[0], value: 'not-json' }])
    expect(exporter.getEntryCount()).toBe(1)
  })
})
