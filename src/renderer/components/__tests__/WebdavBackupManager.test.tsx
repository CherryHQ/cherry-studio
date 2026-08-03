import '@testing-library/jest-dom/vitest'

import { preferenceService } from '@data/PreferenceService'
import { popup } from '@renderer/services/popup'
import { toast } from '@renderer/services/toast'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type * as ReactModule from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { restoreFromNutstore } from '../../services/NutstoreService'
import { WebdavBackupManager } from '../WebdavBackupManager'

const mocks = vi.hoisted(() => ({
  decryptToken: vi.fn(),
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

describe('WebdavBackupManager', () => {
  beforeEach(async () => {
    vi.clearAllMocks()

    await preferenceService.set('data.backup.nutstore.token', 'encrypted-token')
    await preferenceService.set('data.backup.nutstore.path', '/cherry-studio')

    mocks.decryptToken.mockResolvedValue({ username: 'user', access_token: 'access-token' })
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
        listWebdavFiles: mocks.listWebdavFiles,
        restoreFromWebdav: mocks.restoreFromWebdav
      },
      nutstore: {
        decryptToken: mocks.decryptToken
      }
    })
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
})
