import '@testing-library/jest-dom/vitest'

import type { FileMetadata } from '@shared/data/types/legacyFile'
import { FILE_TYPE } from '@shared/types/file'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const backupHook = vi.hoisted(() => ({
  startBackup: vi.fn(),
  cancelBackup: vi.fn(),
  startRestore: vi.fn()
}))

vi.mock('@renderer/hooks/useBackupV2', () => ({
  useBackupV2: () => ({
    loading: false,
    error: null,
    archivePath: null,
    backupId: null,
    progress: null,
    cancelled: false,
    ...backupHook
  })
}))

import { BackupV2DevExport } from '../BackupV2DevExport'

const SELECTED_ARCHIVE: FileMetadata = {
  id: 'archive-1',
  name: 'full.cbu',
  origin_name: 'full.cbu',
  path: '/backups/full.cbu',
  size: 1024,
  ext: 'cbu',
  type: FILE_TYPE.OTHER,
  created_at: '2026-07-16T00:00:00.000Z',
  count: 0
}

const selectFile = vi.fn<typeof window.api.file.select>()

beforeEach(() => {
  vi.clearAllMocks()
  selectFile.mockResolvedValue(null)
  backupHook.startRestore.mockResolvedValue({ restoreId: 'rst-123' })
  Object.assign(window, {
    api: {
      ...window.api,
      file: {
        ...window.api.file,
        select: selectFile
      }
    }
  })
})

afterEach(cleanup)

describe('BackupV2DevExport restore controls', () => {
  it('opens a single-file picker restricted to .cbu archives and renders the selection', async () => {
    const user = userEvent.setup()
    selectFile.mockResolvedValue([SELECTED_ARCHIVE])
    render(<BackupV2DevExport />)

    await user.click(screen.getByTestId('v2-restore-choose'))

    await waitFor(() => expect(screen.getByTestId('v2-restore-path')).toHaveValue('/backups/full.cbu'))
    expect(selectFile).toHaveBeenCalledWith({
      filters: [{ name: 'Cherry backup', extensions: ['cbu'] }],
      properties: ['openFile']
    })
    expect(screen.getByTestId('v2-restore-run')).toBeEnabled()
  })

  it('leaves restore disabled when the picker is cancelled', async () => {
    const user = userEvent.setup()
    render(<BackupV2DevExport />)

    await user.click(screen.getByTestId('v2-restore-choose'))

    expect(screen.getByTestId('v2-restore-path')).toHaveValue('')
    expect(screen.getByTestId('v2-restore-run')).toBeDisabled()
  })

  it('starts restore for the selected archive and exposes the staged relaunch status', async () => {
    const user = userEvent.setup()
    selectFile.mockResolvedValue([SELECTED_ARCHIVE])
    render(<BackupV2DevExport />)

    await user.click(screen.getByTestId('v2-restore-choose'))
    await user.click(screen.getByTestId('v2-restore-run'))

    await waitFor(() => expect(backupHook.startRestore).toHaveBeenCalledWith('/backups/full.cbu'))
    expect(screen.getByText('restore rst-123 staged; relaunching')).toBeInTheDocument()
  })

  it('shows picker and restore failures inline', async () => {
    const user = userEvent.setup()
    selectFile.mockRejectedValueOnce(new Error('picker failed'))
    render(<BackupV2DevExport />)

    await user.click(screen.getByTestId('v2-restore-choose'))
    await waitFor(() => expect(screen.getByText('picker failed')).toBeInTheDocument())

    selectFile.mockResolvedValue([SELECTED_ARCHIVE])
    backupHook.startRestore.mockRejectedValueOnce(new Error('restore failed'))
    await user.click(screen.getByTestId('v2-restore-choose'))
    await user.click(screen.getByTestId('v2-restore-run'))

    await waitFor(() => expect(screen.getByText('restore failed')).toBeInTheDocument())
  })
})
