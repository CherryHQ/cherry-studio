import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { popup } from '@renderer/services/popup'

const { listMock, prepareMock, requestMock, tMock } = vi.hoisted(() => ({
  listMock: vi.fn(),
  prepareMock: vi.fn(),
  requestMock: vi.fn(),
  tMock: vi.fn()
}))

// The table and dialog are the surface under test, so use the real primitives.
vi.mock('@cherrystudio/ui', async (importOriginal) => await importOriginal())

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: tMock })
}))

vi.mock('@renderer/ipc', () => ({ ipcApi: { request: requestMock } }))

vi.mock('@renderer/services/backupDestination', () => ({
  deleteDestinationBackup: vi.fn(),
  listDestinationBackups: listMock,
  prepareRestoreFromDestination: prepareMock
}))

import { LocalBackupManager } from '../LocalBackupManager'

/**
 * A destination restore goes through the same prepare → confirm → arm steps as
 * the file-based one, so the confirmation must show what preparation found and
 * declining must release the preparation it made.
 */

const preview = {
  restoreId: 'r1',
  coverage: { available: 1, rebuildable: 0, missing: 1, unverifiable: 0 },
  resources: { install: 1, replace: 0 },
  knowledge: { ready: 0, rebuild: 0 },
  degradations: [{ code: 'resource-unavailable', count: 1, paths: ['Data/Files/a.pdf'] }],
  migratedForward: false
}

async function clickRestore() {
  const onClose = vi.fn()
  render(<LocalBackupManager visible onClose={onClose} destination="local" />)
  fireEvent.click(await screen.findByRole('button', { name: 'settings.data.local.backup.manager.restore.text' }))
  await waitFor(() => expect(popup.confirm).toHaveBeenCalledOnce())
  return onClose
}

beforeEach(() => {
  vi.clearAllMocks()
  tMock.mockImplementation((key: string) => key)
  listMock.mockResolvedValue([{ name: 'a.cherrybackup', modifiedAt: 0, size: 1 }])
  prepareMock.mockResolvedValue({ status: 'prepared', preview })
  requestMock.mockResolvedValue(undefined)
})

describe('LocalBackupManager restore', () => {
  it('confirms with the prepared preview, degradations included', async () => {
    await clickRestore()

    const props = vi.mocked(popup.confirm).mock.calls[0][0]
    expect(props.title).toBe('settings.data.backup_v2.restore.confirm_title')
    const details = render(props.content as ReactElement)
    expect(details.getByText('settings.data.backup_v2.restore.confirm_content')).toBeInTheDocument()
    expect(details.getByText('settings.data.backup_v2.outcome.degradation.resource_unavailable')).toBeInTheDocument()
    expect(details.getByText('Data/Files/a.pdf')).toBeInTheDocument()
  })

  it('releases the preparation when the user declines', async () => {
    vi.mocked(popup.confirm).mockResolvedValueOnce(false)

    const onClose = await clickRestore()

    await waitFor(() => expect(requestMock).toHaveBeenCalledWith('backup.cancel_restore'))
    expect(requestMock).not.toHaveBeenCalledWith('backup.arm_restore', expect.anything())
    expect(onClose).not.toHaveBeenCalled()
  })

  it('arms exactly the prepared restore once confirmed', async () => {
    await clickRestore()

    await waitFor(() => expect(requestMock).toHaveBeenCalledWith('backup.arm_restore', { restoreId: 'r1' }))
    expect(requestMock).not.toHaveBeenCalledWith('backup.cancel_restore')
  })
})
