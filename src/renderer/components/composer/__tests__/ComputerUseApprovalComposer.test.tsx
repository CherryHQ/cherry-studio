import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from '@renderer/i18n/resolver'
import { ipcApi } from '@renderer/ipc'

import { ComputerUseApprovalComposer } from '../variants/ComputerUseApprovalComposer'

vi.unmock('@cherrystudio/ui')
vi.mock('@renderer/ipc', () => ({ ipcApi: { request: vi.fn() }, useIpcOn: vi.fn() }))
const request = {
  approvalId: 'approval',
  topicId: 'agent-session:one',
  app: { id: 'app', name: 'Editor', identity: 'com.example.editor' }
}
beforeEach(async () => {
  vi.clearAllMocks()
  await i18n.changeLanguage('en-us')
})
afterEach(cleanup)

describe('application approval decisions', () => {
  it.each([
    ['Always', 'always'],
    ['Approve for session', 'session'],
    ['Reject', 'reject']
  ])('delivers %s with the selected scope instead of a generic tool approval', async (label, scope) => {
    let decision: unknown
    vi.mocked(ipcApi.request).mockImplementation(async (route, input) => {
      if (route === 'computer_use.get_app_icon') return { status: 'unavailable' }
      if (route === 'computer_use.respond_approval') {
        decision = input
        return true
      }
      throw new Error(`Unexpected route ${route}`)
    })
    render(<ComputerUseApprovalComposer request={request} onResponded={() => {}} />)
    expect(screen.getByText('com.example.editor')).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: label }))
    expect(decision).toEqual({ approvalId: request.approvalId, scope })
    expect(screen.getByRole('button', { name: 'Always' })).toBeDisabled()
  })

  it('allows retry after a failed response without silently granting permission', async () => {
    let failed = true
    let grants = 0
    vi.mocked(ipcApi.request).mockImplementation(async (route) => {
      if (route === 'computer_use.get_app_icon') return { status: 'unavailable' }
      if (failed) throw new Error('IPC failed')
      grants++
      return true
    })
    render(<ComputerUseApprovalComposer request={request} onResponded={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: 'Always' }))
    expect(await screen.findByRole('alert')).toBeVisible()
    expect(grants).toBe(0)
    failed = false
    await userEvent.click(screen.getByRole('button', { name: 'Always' }))
    await waitFor(() => expect(grants).toBe(1))
  })
})
