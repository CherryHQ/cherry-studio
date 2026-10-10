import { beforeEach, describe, expect, it, vi } from 'vitest'

import { MigrationIpcChannels } from '@shared/data/migration/v2/types'

import { ReduxExporter } from '../ReduxExporter'

const invoke = vi.fn()
const CHUNK_LIMIT = 1024 * 1024
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u

describe('ReduxExporter', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
    invoke.mockResolvedValue(true)
    ;(window as unknown as { electron: { ipcRenderer: { invoke: typeof invoke } } }).electron = {
      ipcRenderer: { invoke }
    }
  })

  it('writes only selected slices as separate files without parsing their contents', async () => {
    localStorage.setItem(
      'persist:cherry-studio',
      JSON.stringify({ assistants: 'not-json', ignored: '{"large":true}', settings: '{"theme":"dark"}' })
    )

    const result = await new ReduxExporter().export('/export/redux')

    expect(result.slicesFound).toEqual(['settings', 'assistants'])
    expect(invoke.mock.calls.map((call) => call[2])).toEqual(['assistants', 'settings'])
    expect(invoke.mock.calls.map((call) => call[3])).toEqual(['not-json', '{"theme":"dark"}'])
    expect(invoke.mock.calls.every((call) => call[0] === MigrationIpcChannels.WriteExportFile)).toBe(true)
  })

  it('splits a large slice on valid UTF-16 boundaries', async () => {
    const settings = `${'a'.repeat(CHUNK_LIMIT - 1)}😀tail`
    localStorage.setItem('persist:cherry-studio', JSON.stringify({ settings }))

    await new ReduxExporter().export('/export/redux')

    const chunks = invoke.mock.calls.map((call) => String(call[3]))
    expect(chunks.every((chunk) => chunk.length <= CHUNK_LIMIT)).toBe(true)
    expect(chunks.every((chunk) => !LONE_SURROGATE.test(chunk))).toBe(true)
    expect(chunks.join('')).toBe(settings)
    expect(invoke.mock.calls[0]?.[4]).toBe('overwrite')
    expect(invoke.mock.calls.slice(1).every((call) => call[4] === 'append')).toBe(true)
  })

  it('creates an empty file for a present empty slice', async () => {
    localStorage.setItem('persist:cherry-studio', JSON.stringify({ settings: '' }))

    const result = await new ReduxExporter().export('/export/redux')

    expect(result.slicesFound).toEqual(['settings'])
    expect(invoke).toHaveBeenCalledWith(
      MigrationIpcChannels.WriteExportFile,
      '/export/redux',
      'settings',
      '',
      'overwrite'
    )
  })

  it('decodes JSON string escapes while streaming the slice to disk', async () => {
    const settings = '{"line":"first\\nsecond","quote":"\\\"","emoji":"😀","control":"\\b\\f\\r\\t"}'
    localStorage.setItem('persist:cherry-studio', JSON.stringify({ settings }))

    await new ReduxExporter().export('/export/redux')

    expect(invoke.mock.calls.map((call) => String(call[3])).join('')).toBe(settings)
  })

  it('preserves export write errors instead of reporting them as parse failures', async () => {
    localStorage.setItem('persist:cherry-studio', JSON.stringify({ settings: '{"theme":"dark"}' }))
    const writeError = new Error('disk full')
    invoke.mockRejectedValueOnce(writeError)

    await expect(new ReduxExporter().export('/export/redux')).rejects.toBe(writeError)
  })

  it('labels malformed Redux Persist data as a parse failure', async () => {
    localStorage.setItem('persist:cherry-studio', '{')

    await expect(new ReduxExporter().export('/export/redux')).rejects.toThrow(
      'Failed to parse Redux Persist root data: Unterminated Redux Persist root object'
    )
  })
})
