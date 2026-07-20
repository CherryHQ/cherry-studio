import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const dexieMock = vi.hoisted(() => ({
  close: vi.fn(),
  exists: vi.fn(),
  open: vi.fn(),
  tableCount: vi.fn(),
  tableRows: vi.fn(),
  tables: [{ name: 'topics' }]
}))

vi.mock('dexie', () => ({
  Dexie: class MockDexie {
    static exists = dexieMock.exists
    readonly tables = dexieMock.tables

    open = dexieMock.open
    close = dexieMock.close

    table(): { toArray: typeof dexieMock.tableRows; count: typeof dexieMock.tableCount } {
      return { toArray: dexieMock.tableRows, count: dexieMock.tableCount }
    }
  }
}))

import { DexieExporter, LocalStorageExporter, ReduxExporter } from '..'
import { RendererExportError, rendererExportMessage, rendererExportReport } from '../RendererExportError'

async function captureAsync(operation: () => Promise<unknown>): Promise<unknown> {
  try {
    await operation()
  } catch (error) {
    return error
  }
  throw new Error('Expected operation to reject')
}

function captureSync(operation: () => unknown): unknown {
  try {
    operation()
  } catch (error) {
    return error
  }
  throw new Error('Expected operation to throw')
}

function expectTaggedFailure(error: unknown, report: RendererExportError['report'], privateMessage: string): void {
  expect(error).toBeInstanceOf(RendererExportError)
  expect(rendererExportReport(error)).toEqual(report)
  expect(rendererExportMessage(error)).toBe(privateMessage)
  expect(JSON.stringify(rendererExportReport(error))).not.toContain(privateMessage)
}

describe('migration renderer exporters', () => {
  const invoke = vi.fn()

  beforeEach(() => {
    vi.restoreAllMocks()
    localStorage.clear()
    invoke.mockReset().mockResolvedValue(true)
    dexieMock.close.mockReset()
    dexieMock.exists.mockReset().mockResolvedValue(true)
    dexieMock.open.mockReset().mockResolvedValue(undefined)
    dexieMock.tableCount.mockReset().mockResolvedValue(0)
    dexieMock.tableRows.mockReset().mockResolvedValue([])
    dexieMock.tables.splice(0, dexieMock.tables.length, { name: 'topics' })
    ;(window as unknown as { electron: { ipcRenderer: { invoke: typeof invoke } } }).electron = {
      ipcRenderer: { invoke }
    }
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('tags a Redux localStorage read failure without exposing its message in the report', () => {
    const cause = new Error('PRIVATE_REDUX_READ_/Users/alice')
    vi.spyOn(Storage.prototype, 'getItem').mockImplementationOnce(() => {
      throw cause
    })

    const error = captureSync(() => new ReduxExporter().export())

    expectTaggedFailure(error, { sourceRole: 'redux', operationRole: 'read' }, cause.message)
  })

  it('tags only the blocking Redux root parse failure', () => {
    const privateValue = 'PRIVATE_REDUX_PARSE_{'
    localStorage.setItem('persist:cherry-studio', privateValue)

    const error = captureSync(() => new ReduxExporter().export())

    expect(error).toBeInstanceOf(RendererExportError)
    expect(rendererExportReport(error)).toEqual({ sourceRole: 'redux', operationRole: 'parse' })
    expect(rendererExportMessage(error)).not.toHaveLength(0)
    expect(JSON.stringify(rendererExportReport(error))).not.toContain(privateValue)
  })

  it.each(['exists', 'open'] as const)('tags a Dexie %s failure as open', async (operation) => {
    const cause = new Error(`PRIVATE_DEXIE_${operation.toUpperCase()}`)
    dexieMock[operation].mockRejectedValueOnce(cause)

    const error = await captureAsync(() => new DexieExporter('/private/export').exportAll())

    expectTaggedFailure(error, { sourceRole: 'dexie', operationRole: 'open' }, cause.message)
  })

  it('tags a Dexie table read failure and still closes the database', async () => {
    const cause = new Error('PRIVATE_DEXIE_READ')
    dexieMock.tableRows.mockRejectedValueOnce(cause)

    const error = await captureAsync(() => new DexieExporter('/private/export').exportAll())

    expectTaggedFailure(error, { sourceRole: 'dexie', operationRole: 'read' }, cause.message)
    expect(dexieMock.close).toHaveBeenCalledOnce()
  })

  it('tags a Dexie serialization failure without retaining the cyclic value', async () => {
    const privateValue: Record<string, unknown> = { marker: 'PRIVATE_DEXIE_SERIALIZE' }
    privateValue.self = privateValue
    dexieMock.tableRows.mockResolvedValueOnce([privateValue])

    const error = await captureAsync(() => new DexieExporter('/private/export').exportAll())

    expect(error).toBeInstanceOf(RendererExportError)
    expect(rendererExportReport(error)).toEqual({ sourceRole: 'dexie', operationRole: 'serialize' })
    expect(JSON.stringify(rendererExportReport(error))).not.toContain('PRIVATE_DEXIE_SERIALIZE')
    expect(dexieMock.close).toHaveBeenCalledOnce()
  })

  it('tags a Dexie IPC rejection as the renderer-to-main write handoff', async () => {
    const cause = new Error('PRIVATE_DEXIE_WRITE')
    invoke.mockRejectedValueOnce(cause)

    const error = await captureAsync(() => new DexieExporter('/private/export').exportAll())

    expectTaggedFailure(error, { sourceRole: 'dexie', operationRole: 'write' }, cause.message)
    expect(dexieMock.close).toHaveBeenCalledOnce()
  })

  it('tags localStorage iteration failures as reads', async () => {
    localStorage.setItem('private-key', 'PRIVATE_LOCAL_STORAGE_READ')
    const cause = new Error('PRIVATE_LOCAL_STORAGE_ITERATION')
    vi.spyOn(Storage.prototype, 'key').mockImplementationOnce(() => {
      throw cause
    })

    const error = await captureAsync(() => new LocalStorageExporter('/private/export').export())

    expectTaggedFailure(error, { sourceRole: 'local_storage', operationRole: 'read' }, cause.message)
  })

  it('tags localStorage serialization failures', async () => {
    localStorage.setItem('private-key', 'PRIVATE_LOCAL_STORAGE_SERIALIZE')
    const cause = new Error('PRIVATE_LOCAL_STORAGE_STRINGIFY')
    vi.spyOn(JSON, 'stringify').mockImplementationOnce(() => {
      throw cause
    })

    const error = await captureAsync(() => new LocalStorageExporter('/private/export').export())

    expectTaggedFailure(error, { sourceRole: 'local_storage', operationRole: 'serialize' }, cause.message)
  })

  it('tags localStorage IPC rejections as writes', async () => {
    localStorage.setItem('private-key', 'PRIVATE_LOCAL_STORAGE_WRITE')
    const cause = new Error('PRIVATE_LOCAL_STORAGE_IPC')
    invoke.mockRejectedValueOnce(cause)

    const error = await captureAsync(() => new LocalStorageExporter('/private/export').export())

    expectTaggedFailure(error, { sourceRole: 'local_storage', operationRole: 'write' }, cause.message)
  })

  it('maps an untagged failure to the fixed unknown report', () => {
    expect(rendererExportReport(new Error('PRIVATE_UNKNOWN'))).toEqual({
      sourceRole: 'unknown',
      operationRole: 'unknown'
    })
  })
})
