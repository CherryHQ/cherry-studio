import { IpcError } from '@shared/ipc/errors'
import { officePreviewErrorCodes } from '@shared/ipc/errors/officePreview'
import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import OfficePreviewPanel from '../OfficePreviewPanel'

const mocks = vi.hoisted(() => ({
  createUniver: vi.fn(),
  createWorkbook: vi.fn(),
  dispose: vi.fn(),
  request: vi.fn(),
  sheetsCorePreset: vi.fn((config: unknown) => ({ plugins: [], config }))
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      error: vi.fn()
    })
  }
}))

vi.mock('@renderer/ipc', () => ({
  ipcApi: {
    request: mocks.request
  }
}))

vi.mock('@univerjs/preset-sheets-core', () => ({
  UniverSheetsCorePreset: mocks.sheetsCorePreset
}))

vi.mock('@univerjs/preset-sheets-core/locales/en-US', () => ({
  default: { locale: 'enUS' }
}))

vi.mock('@univerjs/presets', () => ({
  LocaleType: { EN_US: 'enUS' },
  createUniver: mocks.createUniver,
  defaultTheme: { name: 'default' }
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

const workbook = {
  id: 'workbook-1',
  name: 'report.xlsx',
  appVersion: '0.25.1',
  locale: 'enUS',
  styles: {},
  sheetOrder: ['sheet-1'],
  sheets: {
    'sheet-1': {
      id: 'sheet-1',
      name: 'Sheet1',
      cellData: {}
    }
  }
}

describe('OfficePreviewPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.createUniver.mockReturnValue({
      univer: { dispose: mocks.dispose },
      univerAPI: { createWorkbook: mocks.createWorkbook }
    })
    mocks.request.mockResolvedValue({ kind: 'sheet', workbook })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('requests an Office workbook snapshot and mounts it in Univer', async () => {
    const { unmount } = render(
      <OfficePreviewPanel workspacePath="/tmp/workspace" filePath="report.xlsx" refreshKey={0} />
    )

    await waitFor(() => expect(mocks.createWorkbook).toHaveBeenCalledWith(workbook))

    expect(mocks.request).toHaveBeenCalledWith('office_preview.render', {
      workspacePath: '/tmp/workspace',
      filePath: 'report.xlsx'
    })
    expect(mocks.sheetsCorePreset).toHaveBeenCalledWith(
      expect.objectContaining({
        contextMenu: false,
        formulaBar: false,
        header: false,
        toolbar: false
      })
    )
    expect(mocks.createUniver).toHaveBeenCalledWith(
      expect.objectContaining({
        locale: 'enUS',
        presets: [expect.any(Object)]
      })
    )

    unmount()

    expect(mocks.dispose).toHaveBeenCalled()
  })

  it('shows a localized Office preview error when parsing fails', async () => {
    mocks.request.mockRejectedValueOnce(new IpcError(officePreviewErrorCodes.PARSE_FAILED))

    render(<OfficePreviewPanel workspacePath="/tmp/workspace" filePath="broken.xlsx" refreshKey={0} />)

    await waitFor(() => expect(screen.getByText('agent.preview_pane.excel.errors.parse_failed')).toBeInTheDocument())
    expect(mocks.createWorkbook).not.toHaveBeenCalled()
  })
})
