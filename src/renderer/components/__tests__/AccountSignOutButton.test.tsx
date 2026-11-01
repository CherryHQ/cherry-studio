import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SWRConfig } from 'swr'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from '@renderer/i18n/resolver'
import type { CherryCloudStatus } from '@shared/ipc/schemas/cherryCloud'

import { AccountSignOutButton } from '../AccountSignOutButton'

vi.unmock('@cherrystudio/ui')

const request = vi.mocked(window.api.ipcApi.request)

beforeEach(async () => {
  vi.clearAllMocks()
  await i18n.changeLanguage('zh-CN')
  request.mockImplementation(async (route) => {
    const status: CherryCloudStatus =
      route === 'cherry_cloud.session.revoke'
        ? { phase: 'signed-out', accountId: null, displayName: null }
        : { phase: 'signed-in', accountId: 'account-1', displayName: 'current-account' }
    return { ok: true, data: status }
  })
})

function renderSignOut() {
  return render(
    <SWRConfig value={{ provider: () => new Map() }}>
      <AccountSignOutButton />
    </SWRConfig>
  )
}

describe('AccountSignOutButton', () => {
  it('requires confirmation and keeps the session when the user cancels', async () => {
    const user = userEvent.setup()
    renderSignOut()
    await user.click(await screen.findByRole('button', { name: '退出登录' }))

    const dialog = screen.getByRole('dialog', { name: '退出账号 current-account？' })
    expect(dialog).toHaveAccessibleDescription('退出登录后订阅套餐内的模型将无法使用')
    expect(request).not.toHaveBeenCalledWith('cherry_cloud.session.revoke', undefined)
    await user.click(within(dialog).getByRole('button', { name: '取消' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: '退出登录' })).toBeEnabled()
    expect(request).not.toHaveBeenCalledWith('cherry_cloud.session.revoke', undefined)
  })

  it('uses a generic title when the account name is unavailable', async () => {
    request.mockResolvedValue({ ok: true, data: { phase: 'signed-in', accountId: 'account-1', displayName: null } })
    const user = userEvent.setup()
    renderSignOut()
    await user.click(await screen.findByRole('button', { name: '退出登录' }))

    const dialog = screen.getByRole('dialog', { name: '退出当前账号？' })
    expect(dialog).toHaveAccessibleDescription('退出登录后订阅套餐内的模型将无法使用')
    await user.click(within(dialog).getByRole('button', { name: '取消' }))
  })

  it('revokes the session only after confirmation and removes the action after signing out', async () => {
    const user = userEvent.setup()
    renderSignOut()
    await user.click(await screen.findByRole('button', { name: '退出登录' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: '退出登录' }))

    await waitFor(() => expect(screen.queryByRole('button', { name: '退出登录' })).not.toBeInTheDocument())
    expect(request).toHaveBeenCalledWith('cherry_cloud.session.revoke', undefined)
  })
})
