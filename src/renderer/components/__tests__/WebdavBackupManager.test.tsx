import '@testing-library/jest-dom/vitest'

import { preferenceService } from '@data/PreferenceService'
import { popup } from '@renderer/services/popup'
import { toast } from '@renderer/services/toast'
import { BACKUP_ACTIVE_WRITERS_ERROR_CODE } from '@shared/types/backup'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type * as ReactModule from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { restoreFromNutstore, startNutstoreAutoSync, stopNutstoreAutoSync } from '../../services/NutstoreService'
import { WebdavBackupManager } from '../WebdavBackupManager'

const mocks = vi.hoisted(() => ({
  decryptToken: vi.fn(),
  backupToWebdav: vi.fn(),
  listWebdavFiles: vi.fn(),
  restoreFromWebdav: vi.fn()
}))

vi.mock('@cherrystudio/ui', async () => {
  const React = await vi.importActual<typeof ReactModule>('react')

  type ChildrenProps = { children?: ReactModule.ReactNode }
  type ButtonProps = Omit<ReactModule.ButtonHTMLAttributes<HTMLButtonElement>, 'size'> & {
    size?: string
    variant?: string
  }
  type TestColumn = {
    id?: string
    accessorKey?: string
    cell?: (context: { getValue: () => unknown; row: { original: Record<string, unknown> } }) => ReactModule.ReactNode
  }

  return {
    Button: ({ children, size, variant, ...props }: ButtonProps) =>
      React.createElement('button', { ...props, 'data-size': size, 'data-variant': variant }, children),
    DataTable: ({ columns, data }: { columns: TestColumn[]; data: Array<Record<string, unknown>> }) =>
      React.createElement(
        'div',
        null,
        data.map((record, rowIndex) =>
          React.createElement(
            React.Fragment,
            { key: rowIndex },
            columns.map((column, columnIndex) =>
              React.createElement(
                React.Fragment,
                { key: column.id ?? column.accessorKey ?? columnIndex },
                column.cell?.({
                  getValue: () => (column.accessorKey ? record[column.accessorKey] : undefined),
                  row: { original: record }
                })
              )
            )
          )
        )
      ),
    Dialog: ({ children, open }: ChildrenProps & { open?: boolean }) => (open ? children : null),
    DialogContent: ({ children }: ChildrenProps) => React.createElement('div', null, children),
    DialogFooter: ({ children }: ChildrenProps) => React.createElement('footer', null, children),
    DialogHeader: ({ children }: ChildrenProps) => React.createElement('header', null, children),
    DialogTitle: ({ children }: ChildrenProps) => React.createElement('h2', null, children),
    Spinner: () => React.createElement('div'),
    Tooltip: ({ children }: ChildrenProps) => children
  }
})

vi.mock('react-i18next', () => {
  const t = (key: string) => key
  return { useTranslation: () => ({ t }) }
})

vi.mock('@renderer/i18n/resolver', () => ({
  default: { t: (key: string) => key }
}))

describe('WebdavBackupManager', () => {
  beforeEach(async () => {
    vi.clearAllMocks()

    await preferenceService.set('data.backup.nutstore.token', 'encrypted-token')
    await preferenceService.set('data.backup.nutstore.path', '/cherry-studio')
    await preferenceService.set('data.backup.nutstore.sync_interval', 1)
    await preferenceService.set('data.backup.nutstore.max_backups', 0)
    await preferenceService.set('data.backup.nutstore.skip_backup_file', false)

    mocks.decryptToken.mockResolvedValue({ username: 'user', access_token: 'access-token' })
    mocks.backupToWebdav.mockRejectedValue(new Error('Backup failed'))
    mocks.listWebdavFiles.mockResolvedValue([
      { fileName: 'cherry-studio.v6.zip', modifiedTime: '2026-08-03T00:00:00.000Z', size: 1024 }
    ])
    mocks.restoreFromWebdav.mockRejectedValue(
      new Error(
        "Error invoking remote method 'backup:restoreFromWebdav': Error: Unsupported backup version 6. Cherry Studio v2 can only restore backup version 7."
      )
    )

    Object.assign(window.api, {
      backup: {
        backupToWebdav: mocks.backupToWebdav,
        listWebdavFiles: mocks.listWebdavFiles,
        restoreFromWebdav: mocks.restoreFromWebdav
      },
      nutstore: {
        decryptToken: mocks.decryptToken
      }
    })
  })

  afterEach(() => {
    stopNutstoreAutoSync()
    vi.useRealTimers()
  })

  it('shows only the localized failure toast when a Nutstore restore fails', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()

    render(
      <WebdavBackupManager
        visible
        onClose={onClose}
        webdavConfig={{
          webdavHost: 'https://dav.jianguoyun.com/dav',
          webdavUser: 'user',
          webdavPass: 'access-token',
          webdavPath: '/cherry-studio'
        }}
        restoreMethod={restoreFromNutstore}
      />
    )

    await user.click(await screen.findByRole('button', { name: 'settings.data.webdav.backup.manager.restore.text' }))

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledExactlyOnceWith('settings.data.webdav.backup.manager.restore.error')
    })
    expect(toast.success).not.toHaveBeenCalled()
    expect(popup.error).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('shows one failure toast after Nutstore automatic backup retries are exhausted', async () => {
    vi.useFakeTimers()
    mocks.backupToWebdav.mockRejectedValue(
      new Error(`${BACKUP_ACTIVE_WRITERS_ERROR_CODE}: A conversation is still running.`)
    )

    await startNutstoreAutoSync()
    await vi.advanceTimersByTimeAsync(60_000)
    await vi.advanceTimersByTimeAsync(7_000)
    await vi.advanceTimersByTimeAsync(17_000)
    await vi.advanceTimersByTimeAsync(37_000)

    expect(mocks.backupToWebdav).toHaveBeenCalledTimes(4)
    expect(toast.error).toHaveBeenCalledExactlyOnceWith('backup.error.active_data_writers')
    expect(popup.error).not.toHaveBeenCalled()
  })
})
