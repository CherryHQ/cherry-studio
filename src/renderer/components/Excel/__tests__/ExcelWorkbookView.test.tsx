import { render, waitFor } from '@testing-library/react'
import { type IWorkbookData, LocaleType } from '@univerjs/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import ExcelWorkbookView from '../ExcelWorkbookView'

const mocks = vi.hoisted(() => ({
  addTable: vi.fn(),
  beforeCommandListener: undefined as
    | ((commandInfo: { id: string; type?: number }, options?: { fromChangeset?: boolean; onlyLocal?: boolean }) => void)
    | undefined,
  commandGuardDispose: vi.fn(),
  configSet: vi.fn(),
  createWorkbook: vi.fn(),
  imageRendererDispose: vi.fn(),
  mergeLocales: vi.fn((locale: unknown) => locale),
  onBeforeCommandExecute: vi.fn(),
  onCellRender: vi.fn(),
  presetConfig: undefined as
    | {
        footer?: { addSheetButtonConfig?: { show?: boolean } }
        sheets?: { disableForceStringAlert?: boolean; disableForceStringMark?: boolean }
      }
    | undefined,
  registerPlugins: vi.fn(),
  setTableFilter: vi.fn(),
  univerInstances: [] as Array<{
    __getInjector: () => { get: ReturnType<typeof vi.fn> }
    dispose: ReturnType<typeof vi.fn>
    registerPlugins: ReturnType<typeof vi.fn>
  }>
}))

vi.mock('@univerjs/core', () => ({
  BooleanNumber: { FALSE: 0, TRUE: 1 },
  CanceledError: class CanceledError extends Error {},
  CellValueType: { STRING: 1, NUMBER: 2, BOOLEAN: 3 },
  CommandType: { COMMAND: 0, MUTATION: 2, OPERATION: 1 },
  IConfigService: Symbol('IConfigService'),
  LocaleType: { EN_US: 'enUS' },
  mergeLocales: mocks.mergeLocales,
  Univer: vi.fn(function Univer() {
    const instance = {
      __getInjector: () => ({
        get: vi.fn(() => ({
          setConfig: mocks.configSet
        }))
      }),
      dispose: vi.fn(),
      registerPlugins: mocks.registerPlugins
    }
    mocks.univerInstances.push(instance)
    return instance
  })
}))

vi.mock('@univerjs/core/facade', () => ({
  FUniver: {
    newAPI: () => ({
      createWorkbook: mocks.createWorkbook,
      getSheetHooks: () => ({
        onCellRender: mocks.onCellRender
      }),
      onBeforeCommandExecute: mocks.onBeforeCommandExecute
    })
  }
}))

vi.mock('@univerjs/preset-sheets-core', () => ({
  UniverSheetsCorePreset: (config: {
    footer?: { addSheetButtonConfig?: { show?: boolean } }
    sheets?: { disableForceStringAlert?: boolean; disableForceStringMark?: boolean }
  }) => {
    mocks.presetConfig = config
    return {
      plugins: [class MockPlugin {}, [class ConfiguredMockPlugin {}, { enabled: true }]]
    }
  }
}))

vi.mock('@univerjs/preset-sheets-core/locales/en-US', () => ({
  default: {}
}))

vi.mock('@univerjs/preset-sheets-filter/locales/en-US', () => ({
  default: {}
}))

vi.mock('@univerjs/preset-sheets-filter', () => ({
  UniverSheetsFilterPreset: () => ({
    plugins: [class MockFilterPlugin {}]
  })
}))

vi.mock('@univerjs/preset-sheets-table', () => ({
  UniverSheetsTablePlugin: class MockTablePlugin {},
  UniverSheetsTableUIPlugin: class MockTableUIPlugin {}
}))

vi.mock('@univerjs/preset-sheets-table/locales/en-US', () => ({
  default: {}
}))

const makeWorkbookData = (id: string): IWorkbookData => ({
  id,
  name: `${id}.xlsx`,
  appVersion: '0.25.0',
  locale: LocaleType.EN_US,
  sheetOrder: ['sheet-1'],
  sheets: {
    'sheet-1': {
      cellData: {},
      id: 'sheet-1',
      name: 'Sheet1'
    }
  },
  styles: {}
})

describe('ExcelWorkbookView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.addTable.mockResolvedValue(true)
    mocks.beforeCommandListener = undefined
    mocks.onCellRender.mockReturnValue({ dispose: mocks.imageRendererDispose })
    mocks.presetConfig = undefined
    mocks.setTableFilter.mockResolvedValue(true)
    mocks.onBeforeCommandExecute.mockImplementation(
      (
        listener: (
          commandInfo: { id: string; type?: number },
          options?: { fromChangeset?: boolean; onlyLocal?: boolean }
        ) => void
      ) => {
        mocks.beforeCommandListener = listener
        return { dispose: mocks.commandGuardDispose }
      }
    )
    mocks.univerInstances.length = 0
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('creates a Univer workbook and disposes stale instances on workbook changes and unmount', async () => {
    const workbookData = makeWorkbookData('report')
    const nextWorkbookData = makeWorkbookData('report-refresh')
    const { rerender, unmount } = render(
      <ExcelWorkbookView workbookData={workbookData} ariaLabel="report.xlsx" readOnly />
    )

    await waitFor(() => expect(mocks.createWorkbook).toHaveBeenCalledTimes(1))
    expect(mocks.createWorkbook).toHaveBeenCalledWith(workbookData)
    expect(mocks.univerInstances).toHaveLength(1)
    expect(mocks.registerPlugins).toHaveBeenCalledWith([
      [expect.any(Function)],
      [expect.any(Function), { enabled: true }],
      [expect.any(Function)],
      [expect.any(Function)],
      [expect.any(Function), { hideAnchor: true }]
    ])
    expect(mocks.presetConfig?.footer?.addSheetButtonConfig?.show).toBe(false)
    expect(mocks.presetConfig?.sheets).toEqual({
      disableForceStringAlert: true,
      disableForceStringMark: true
    })
    expect(mocks.configSet).toHaveBeenCalledWith(
      'sheets-ui.config',
      {
        disableEdit: true,
        clipboardConfig: {
          hidePasteOptions: true
        },
        footer: {
          addSheetButtonConfig: {
            show: false
          }
        }
      },
      { merge: true }
    )
    expect(mocks.onBeforeCommandExecute).toHaveBeenCalledTimes(1)
    expect(mocks.onCellRender).toHaveBeenCalledTimes(1)
    expect(mocks.onCellRender).toHaveBeenCalledWith([expect.objectContaining({ drawWith: expect.any(Function) })])
    expect(mocks.createWorkbook.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.onBeforeCommandExecute.mock.invocationCallOrder[0]
    )
    expect(mocks.createWorkbook.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.onCellRender.mock.invocationCallOrder[0]
    )
    expect(() => mocks.beforeCommandListener?.({ id: 'sheet.command.select-range', type: 0 })).not.toThrow()
    expect(() => mocks.beforeCommandListener?.({ id: 'sheet.command.set-scroll-relative', type: 0 })).not.toThrow()
    expect(() => mocks.beforeCommandListener?.({ id: 'sheet.command.scroll-view', type: 0 })).not.toThrow()
    expect(() => mocks.beforeCommandListener?.({ id: 'sheet.command.scroll-to-cell', type: 0 })).not.toThrow()
    expect(() => mocks.beforeCommandListener?.({ id: 'sheet.command.scroll-view-reset', type: 0 })).not.toThrow()
    expect(() => mocks.beforeCommandListener?.({ id: 'sheet.command.set-zoom-ratio', type: 0 })).not.toThrow()
    expect(() => mocks.beforeCommandListener?.({ id: 'sheet.command.change-zoom-ratio', type: 0 })).not.toThrow()
    expect(() => mocks.beforeCommandListener?.({ id: 'sheet.command.set-table-filter', type: 0 })).not.toThrow()
    expect(() => mocks.beforeCommandListener?.({ id: 'sheet.command.insert-sheet', type: 0 })).toThrow()
    expect(() => mocks.beforeCommandListener?.({ id: 'sheet.mutation.set-table-filter', type: 2 })).not.toThrow()
    expect(() => mocks.beforeCommandListener?.({ id: 'sheet.mutation.set-range-values', type: 2 })).toThrow()
    expect(() =>
      mocks.beforeCommandListener?.(
        { id: 'formula.mutation.set-formula-calculation-result', type: 2 },
        { onlyLocal: true }
      )
    ).not.toThrow()
    expect(() =>
      mocks.beforeCommandListener?.({ id: 'sheet.mutation.set-range-values', type: 2 }, { fromChangeset: true })
    ).not.toThrow()

    rerender(<ExcelWorkbookView workbookData={nextWorkbookData} ariaLabel="report.xlsx" readOnly />)

    await waitFor(() => expect(mocks.createWorkbook).toHaveBeenCalledTimes(2))
    expect(mocks.createWorkbook).toHaveBeenLastCalledWith(nextWorkbookData)
    expect(mocks.univerInstances).toHaveLength(2)
    expect(mocks.commandGuardDispose).toHaveBeenCalledTimes(1)
    expect(mocks.imageRendererDispose).toHaveBeenCalledTimes(1)
    expect(mocks.univerInstances[0].dispose).toHaveBeenCalledTimes(1)

    unmount()

    expect(mocks.commandGuardDispose).toHaveBeenCalledTimes(2)
    expect(mocks.imageRendererDispose).toHaveBeenCalledTimes(2)
    expect(mocks.univerInstances[1].dispose).toHaveBeenCalledTimes(1)
  })

  it('creates structured Excel tables and applies supported filters before guarding commands', async () => {
    const workbookData = makeWorkbookData('report')
    const filter = {
      filterType: 'condition' as const,
      filterInfo: {
        conditionType: 'number' as const,
        compareType: 'greaterThanOrEqual' as const,
        expectedValue: 10
      }
    }
    mocks.addTable.mockResolvedValueOnce('created-table-id')
    mocks.createWorkbook.mockReturnValueOnce({
      addTable: mocks.addTable,
      setTableFilter: mocks.setTableFilter
    })

    render(
      <ExcelWorkbookView
        workbookData={workbookData}
        ariaLabel="report.xlsx"
        readOnly
        tables={[
          {
            columns: [
              { id: 'excel-table-sheet-1-Sales-column-1', displayName: 'Region' },
              { id: 'excel-table-sheet-1-Sales-column-2', displayName: 'Amount' }
            ],
            filters: [null, filter],
            id: 'excel-table-sheet-1-Sales',
            name: 'Sales',
            range: { startRow: 0, startColumn: 0, endRow: 3, endColumn: 1 },
            sheetId: 'sheet-1',
            showFooter: true,
            showHeader: true,
            tableStyleId: 'table-default-0'
          }
        ]}
      />
    )

    await waitFor(() => expect(mocks.addTable).toHaveBeenCalledTimes(1))
    expect(mocks.addTable).toHaveBeenCalledWith(
      'sheet-1',
      'Sales',
      { startRow: 0, startColumn: 0, endRow: 3, endColumn: 1 },
      'excel-table-sheet-1-Sales',
      {
        columns: [
          {
            dataType: 'string',
            displayName: 'Region',
            formula: '',
            id: 'excel-table-sheet-1-Sales-column-1',
            meta: {},
            style: {}
          },
          {
            dataType: 'string',
            displayName: 'Amount',
            formula: '',
            id: 'excel-table-sheet-1-Sales-column-2',
            meta: {},
            style: {}
          }
        ],
        filters: [undefined, filter],
        hasTotalRow: true,
        showFooter: true,
        showHeader: true,
        tableStyleId: 'table-default-0'
      }
    )
    expect(mocks.setTableFilter).toHaveBeenCalledWith('created-table-id', 1, filter)
    expect(mocks.addTable.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.onBeforeCommandExecute.mock.invocationCallOrder[0]
    )
  })

  it('renders the visible slice of referenced Excel images for each covered cell', async () => {
    class MockImage {
      complete = true
      naturalHeight = 100
      naturalWidth = 100
      onerror: (() => void) | null = null
      onload: (() => void) | null = null
      src = ''
    }
    vi.stubGlobal('Image', MockImage)

    const workbookData = makeWorkbookData('images')
    const image = {
      from: { column: 0, columnOffset: 0, row: 0, rowOffset: 0 },
      id: 'image-1',
      source: 'data:image/png;base64,image',
      to: { column: 2, columnOffset: 0, row: 2, rowOffset: 0 }
    }
    workbookData.sheets['sheet-1'].cellData = {
      0: {
        0: { custom: { excelImageRefs: ['image-1'], excelImages: [image] } },
        1: { custom: { excelImageRefs: ['image-1'] } }
      },
      1: {
        0: { custom: { excelImageRefs: ['image-1'] } },
        1: { custom: { excelImageRefs: ['image-1'] } }
      }
    }

    render(<ExcelWorkbookView workbookData={workbookData} ariaLabel="images.xlsx" readOnly />)

    await waitFor(() => expect(mocks.onCellRender).toHaveBeenCalledTimes(1))

    const renderer = mocks.onCellRender.mock.calls[0][0][0]
    const ctx = { drawImage: vi.fn() }
    const cell = { endX: 200, endY: 20, startX: 100, startY: 0 }
    const skeleton = {
      getCellWithCoordByIndex: vi.fn((row: number, column: number) => ({
        endX: (column + 1) * 100,
        endY: (row + 1) * 20,
        startX: column * 100,
        startY: row * 20
      }))
    }

    renderer.drawWith(
      ctx,
      {
        col: 1,
        data: workbookData.sheets['sheet-1'].cellData?.[0]?.[1],
        primaryWithCoord: cell,
        row: 0,
        style: null,
        subUnitId: 'sheet-1',
        unitId: 'images',
        workbook: undefined,
        worksheet: {}
      },
      skeleton,
      { makeDirty: vi.fn() }
    )

    expect(ctx.drawImage).toHaveBeenCalledWith(expect.any(MockImage), 50, 0, 50, 50, 100, 0, 100, 20)
  })

  it('keeps the workbook mounted when table installation fails', async () => {
    const onError = vi.fn()
    mocks.addTable.mockRejectedValueOnce(new Error('table failed'))
    mocks.createWorkbook.mockReturnValueOnce({
      addTable: mocks.addTable,
      setTableFilter: mocks.setTableFilter
    })

    render(
      <ExcelWorkbookView
        workbookData={makeWorkbookData('report')}
        ariaLabel="report.xlsx"
        onError={onError}
        readOnly
        tables={[
          {
            columns: [{ id: 'excel-table-sheet-1-Sales-column-1', displayName: 'Region' }],
            id: 'excel-table-sheet-1-Sales',
            name: 'Sales',
            range: { startRow: 0, startColumn: 0, endRow: 2, endColumn: 0 },
            sheetId: 'sheet-1'
          }
        ]}
      />
    )

    await waitFor(() => expect(mocks.addTable).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(mocks.onBeforeCommandExecute).toHaveBeenCalledTimes(1))
    expect(onError).not.toHaveBeenCalled()
  })

  it('disposes a pending Univer instance and reports initialization errors', async () => {
    const onError = vi.fn()
    mocks.createWorkbook.mockImplementationOnce(() => {
      throw new Error('create failed')
    })

    render(<ExcelWorkbookView workbookData={makeWorkbookData('broken')} onError={onError} readOnly />)

    await waitFor(() => expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'create failed' })))
    expect(mocks.univerInstances).toHaveLength(1)
    expect(mocks.univerInstances[0].dispose).toHaveBeenCalledTimes(1)
    expect(mocks.commandGuardDispose).not.toHaveBeenCalled()
    expect(mocks.imageRendererDispose).not.toHaveBeenCalled()
  })
})
