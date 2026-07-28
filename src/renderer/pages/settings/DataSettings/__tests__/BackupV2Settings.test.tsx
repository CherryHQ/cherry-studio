import '@testing-library/jest-dom/vitest'

import { popup } from '@renderer/services/popup'
import { toast } from '@renderer/services/toast'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { requestMock, tMock } = vi.hoisted(() => ({ requestMock: vi.fn(), tMock: vi.fn((key: string) => key) }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: tMock }) }))
vi.mock('@renderer/ipc', () => ({ ipcApi: { request: requestMock } }))
vi.mock('@renderer/hooks/useTheme', () => ({ useTheme: () => ({ theme: 'light' }) }))
vi.mock('@renderer/components/SettingsPrimitives', () => ({
  SettingDivider: () => <hr />,
  SettingGroup: ({ children }: { children: React.ReactNode }) => <section>{children}</section>,
  SettingHelpText: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SettingRow: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SettingRowTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SettingTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>
}))

import BackupV2Settings from '../BackupV2Settings'

function statusIs(restore: unknown) {
  requestMock.mockImplementation(async (route: string) =>
    route === 'backup.get_status' ? { operation: null, restore } : undefined
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  statusIs({ kind: 'none' })
  vi.mocked(popup.confirm).mockResolvedValue(true)
})

describe('BackupV2Settings', () => {
  it('offers only Lite export and describes database-only restore', async () => {
    render(<BackupV2Settings />)
    await waitFor(() => expect(requestMock).toHaveBeenCalledWith('backup.get_status'))
    expect(screen.getByText('settings.data.backup_v2.export.lite_help')).toBeInTheDocument()
    expect(screen.queryByText(/full/i)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'settings.data.backup_v2.export.button' }))
    await waitFor(() => expect(requestMock).toHaveBeenCalledWith('backup.export'))
  })

  it('arms only the exact restore id shown by main after destructive confirmation', async () => {
    const restoreId = '11111111-2222-4333-8444-555555555555'
    requestMock.mockImplementation(async (route: string) => {
      if (route === 'backup.get_status')
        return { operation: null, restore: { kind: 'journal', state: 'prepared', restoreId } }
      if (route === 'backup.arm_restore') return undefined
      return undefined
    })
    render(<BackupV2Settings />)
    await waitFor(() => expect(requestMock).toHaveBeenCalledWith('backup.get_status'))
    // A preparation from another window cannot be armed without its locally returned preview.
    expect(screen.queryByRole('button', { name: 'settings.data.backup_v2.restore.arm_button' })).not.toBeInTheDocument()
  })

  it('offers keep and rollback for a completed database restore', async () => {
    requestMock.mockImplementation(async (route: string) => {
      if (route === 'backup.get_status') {
        return {
          operation: null,
          restore: { kind: 'journal', state: 'completed', restoreId: '11111111-2222-4333-8444-555555555555' }
        }
      }
      if (route === 'backup.acknowledge_restore')
        return { acknowledged: true, restoreId: '11111111-2222-4333-8444-555555555555', removed: 1 }
      return undefined
    })
    render(<BackupV2Settings />)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'settings.data.backup_v2.rollback.button' })).toBeInTheDocument()
    )
    fireEvent.click(screen.getByRole('button', { name: 'settings.data.backup_v2.outcome.acknowledge_button' }))
    await waitFor(() => expect(requestMock).toHaveBeenCalledWith('backup.acknowledge_restore'))
    expect(toast.closeToast).toHaveBeenCalledWith('backup-restore-notice')
  })
})
