import '@testing-library/jest-dom/vitest'
import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock('@renderer/components/WebdavBackupManager', () => ({ WebdavBackupManager: () => null }))
vi.mock('@renderer/components/WebdavModals', () => ({
  WebdavBackupModal: () => null,
  useWebdavBackupModal: () => ({
    isModalVisible: false,
    handleBackup: vi.fn(),
    handleCancel: vi.fn(),
    backuping: false,
    customFileName: '',
    setCustomFileName: vi.fn(),
    showBackupModal: vi.fn()
  })
}))
vi.mock('@renderer/components/Selector', () => ({ default: () => null }))

import WebDavSettings from '../WebDavSettings'

describe('WebDavSettings sync_start', () => {
  beforeEach(() => {
    MockUsePreferenceUtils.resetMocks()
    MockUsePreferenceUtils.setPreferenceValue('data.backup.webdav.host', 'https://example.com/dav')
    MockUsePreferenceUtils.setPreferenceValue('data.backup.webdav.sync_interval', 360)
  })

  afterEach(() => cleanup())

  it('exposes a first-backup-time field', () => {
    render(<WebDavSettings />)
    expect(screen.getByLabelText('settings.data.backup.syncStart.label')).toBeInTheDocument()
  })

  it('persists the picked time as minutes after midnight', async () => {
    const user = userEvent.setup()
    render(<WebDavSettings />)

    await user.type(screen.getByLabelText('settings.data.backup.syncStart.label'), '1830')

    expect(MockUsePreferenceUtils.getPreferenceValue('data.backup.webdav.sync_start')).toBe(18 * 60 + 30)
  })

  it('clears the anchor when the field is emptied and blurred', async () => {
    const user = userEvent.setup()
    MockUsePreferenceUtils.setPreferenceValue('data.backup.webdav.sync_start', 18 * 60)
    render(<WebDavSettings />)

    const input = screen.getByLabelText('settings.data.backup.syncStart.label')
    await user.clear(input)
    await user.tab()

    expect(MockUsePreferenceUtils.getPreferenceValue('data.backup.webdav.sync_start')).toBeNull()
  })

  it('shows the help text', () => {
    render(<WebDavSettings />)
    expect(screen.getByText('settings.data.backup.syncStart.help')).toBeInTheDocument()
  })
})
