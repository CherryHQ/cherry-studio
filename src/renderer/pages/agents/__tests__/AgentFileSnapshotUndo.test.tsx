import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'

import i18n from '@renderer/i18n/resolver'
import { toast } from '@renderer/services/toast'
import { agentFileSnapshotReason } from '@shared/ipc/schemas/agentFileSnapshot'

import { AgentFileSnapshotUndo, snapshotReasonKeys } from '../components/AgentFileSnapshotUndo'

vi.mock('@renderer/services/toast', () => ({ toast: { success: vi.fn(), warning: vi.fn() } }))

beforeEach(async () => {
  await i18n.changeLanguage('en-US')
  vi.clearAllMocks()
})

it('confirms the listed files and warns when undo only partially succeeds', async () => {
  const state = {
    replyId: 'reply',
    revision: '2',
    canUndo: true,
    reason: null,
    files: [
      { path: '/project/a', status: 'changed' },
      { path: '/project/b', status: 'changed' }
    ]
  }
  vi.mocked(window.api.ipcApi.request).mockImplementation(async (route) => ({
    ok: true,
    data:
      route === 'agent.file_snapshot.state'
        ? state
        : {
            reason: 'partial',
            files: [
              { path: '/project/a', status: 'restored' },
              { path: '/project/b', status: 'failed' }
            ]
          }
  }))
  const user = userEvent.setup()
  render(<AgentFileSnapshotUndo sessionId="session" pending={false} />)
  await user.click(await screen.findByRole('button', { name: 'Undo file changes' }))
  expect(screen.getByText('/project/a')).toBeInTheDocument()
  expect(screen.getByText('/project/b')).toBeInTheDocument()
  await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Undo file changes' }))
  await waitFor(() => expect(toast.warning).toHaveBeenCalledWith('Could not restore 1 files.'))
  expect(toast.success).not.toHaveBeenCalled()
  expect(window.api.ipcApi.request).toHaveBeenCalledWith('agent.file_snapshot.undo', {
    sessionId: 'session',
    replyId: 'reply',
    expectedRevision: '2'
  })
})

it('freezes the confirmation and disables undo when the round changes', async () => {
  let state = {
    replyId: 'reply',
    revision: '2',
    canUndo: true,
    reason: null,
    files: [{ path: '/project/original', status: 'changed' }]
  }
  vi.mocked(window.api.ipcApi.request).mockImplementation(async () => ({ ok: true, data: state }))
  const user = userEvent.setup()
  const view = render(<AgentFileSnapshotUndo sessionId="session" pending={false} />)
  await user.click(await screen.findByRole('button', { name: 'Undo file changes' }))
  state = { ...state, replyId: 'next', revision: '3', files: [{ path: '/project/next', status: 'changed' }] }
  view.rerender(<AgentFileSnapshotUndo sessionId="session" pending />)
  const dialog = screen.getByRole('dialog')
  await within(dialog).findByText('The state has changed. Please confirm again.')
  expect(within(dialog).getByText('/project/original')).toBeInTheDocument()
  expect(within(dialog).queryByText('/project/next')).not.toBeInTheDocument()
  const confirm = within(dialog).getByRole('button', { name: 'Undo file changes' })
  expect(confirm).toBeDisabled()
  await user.click(confirm)
  expect(window.api.ipcApi.request).not.toHaveBeenCalledWith('agent.file_snapshot.undo', expect.anything())
})

it('maps every snapshot reason to a translated message', () => {
  for (const reason of agentFileSnapshotReason.options) {
    const key = snapshotReasonKeys[reason]
    expect(key).toBeTruthy()
    expect(i18n.exists(key)).toBe(true)
  }
})

it('explains that the state changed when a snapshot conflicts', async () => {
  vi.mocked(window.api.ipcApi.request).mockResolvedValue({
    ok: true,
    data: { replyId: 'reply', revision: '2', canUndo: false, reason: 'snapshot-conflict', files: [] }
  })
  render(<AgentFileSnapshotUndo sessionId="session" pending={false} />)
  expect(await screen.findByTitle('The state has changed. Please confirm again.')).toBeInTheDocument()
})
