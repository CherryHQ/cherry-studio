import '@testing-library/jest-dom/vitest'
import { MockUseCacheUtils } from '@test-mocks/renderer/useCache'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'

import { MinimalModeContext } from '@renderer/hooks/useMinimalMode'
import { DefaultUseCache } from '@shared/data/cache/cacheSchemas'

import { MinimalSidebarFooter } from '../MinimalSidebar'

vi.unmock('@cherrystudio/ui')

vi.mock('@renderer/components/Sidebar', () => ({ UserAvatar: () => null }))
vi.mock('@renderer/components/UserPopup', () => ({ default: { show: vi.fn() } }))
vi.mock('@renderer/hooks/useAvatar', () => ({ default: () => '' }))
vi.mock('@renderer/components/layout/HelpMenu', () => ({ HelpMenu: () => null }))
vi.mock('@renderer/components/UpdateDialogPopup', () => ({ default: { show: vi.fn() } }))

import UpdateDialogPopup from '@renderer/components/UpdateDialogPopup'

afterEach(() => {
  cleanup()
  MockUseCacheUtils.resetMocks()
  vi.clearAllMocks()
})

it('offers a downloaded update in the minimal footer and opens its release dialog', async () => {
  const user = userEvent.setup()
  const releaseInfo = { version: '2.0.0', files: [], path: '', sha512: '', releaseDate: '' }
  const footer = (
    <MinimalModeContext
      value={{
        enabled: true,
        isHome: true,
        homeKind: 'agent',
        switchHome: vi.fn(),
        returnHome: vi.fn(),
        openFeature: vi.fn()
      }}>
      <MinimalSidebarFooter />
    </MinimalModeContext>
  )
  MockUseCacheUtils.setCacheValue('app.dist.update_state', {
    ...DefaultUseCache['app.dist.update_state'],
    available: true,
    downloaded: false,
    info: releaseInfo
  })
  const view = render(footer)
  expect(screen.queryByRole('button', { name: /2\.0\.0/ })).not.toBeInTheDocument()

  MockUseCacheUtils.setCacheValue('app.dist.update_state', {
    ...DefaultUseCache['app.dist.update_state'],
    available: true,
    downloaded: true,
    info: releaseInfo
  })
  view.rerender(<div>{footer}</div>)
  await user.click(screen.getByRole('button', { name: /2\.0\.0/ }))
  await waitFor(() => expect(UpdateDialogPopup.show).toHaveBeenCalledWith({ releaseInfo }))
})
