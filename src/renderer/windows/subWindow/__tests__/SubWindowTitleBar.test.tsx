import { MockUseCacheUtils } from '@test-mocks/renderer/useCache'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'

import { TabsProvider } from '@renderer/components/layout/TabsProvider'
import { useTabs } from '@renderer/hooks/tab'

import { SubWindowTitleBar } from '../SubWindowTitleBar'

vi.mock('@renderer/components/AgentBrowserRuntimeHost', () => ({ AgentBrowserRuntimeHost: () => null }))
vi.mock('@renderer/components/layout/SubWindowControls', () => ({ SubWindowControls: () => null }))
vi.mock('@renderer/hooks/useLeadingWindowControlsOverlay', () => ({ useLeadingWindowControlsOverlay: () => false }))
vi.mock('@renderer/ipc', () => ({ ipcApi: { request: vi.fn(async () => {}) }, useIpcOn: () => {} }))
beforeEach(() => MockUseCacheUtils.resetMocks())
function Window() {
  const { openTab, activeTab } = useTabs()
  return (
    <>
      <button type="button" onClick={() => openTab('/app/mini-app/b', { title: 'Beta' })}>
        Open Beta
      </button>
      <SubWindowTitleBar isFullscreen={false} />
      <output aria-label="active page">{activeTab?.url}</output>
    </>
  )
}
it('makes every detached-window tab reachable from the shared tab strip', async () => {
  const user = userEvent.setup()
  render(
    <TabsProvider
      includePinnedTabs={false}
      initialDefaultTab={{ id: 'a', type: 'route', title: 'Alpha', url: '/app/mini-app/a' }}>
      <Window />
    </TabsProvider>
  )
  await user.click(screen.getByText('Open Beta'))
  fireEvent.click(screen.getByRole('button', { name: 'Alpha' }))
  expect(screen.getByLabelText('active page')).toHaveTextContent('/app/mini-app/a')
  expect(screen.getByRole('button', { name: 'Beta' })).toBeInTheDocument()
})
