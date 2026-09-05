import '@testing-library/jest-dom/vitest'

import type { MiniApp as MiniAppType } from '@shared/data/types/miniApp'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@cherrystudio/ui', () => ({
  Button: ({ children, ...props }: { children?: ReactNode }) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>
}))
vi.mock('@renderer/hooks/useMiniApps', () => ({
  useMiniApps: () => ({ pinned: [], allApps: [], updateAppStatus: vi.fn(() => Promise.resolve()) })
}))
vi.mock('@renderer/ipc', () => ({ ipcApi: { request: vi.fn() } }))
vi.mock('@renderer/services/toast', () => ({ toast: { error: vi.fn() } }))
vi.mock('@renderer/utils/platform', () => ({ isDev: true }))
vi.mock('@logger', () => ({
  loggerService: { withContext: () => ({ debug: vi.fn(), warn: vi.fn(), error: vi.fn() }) }
}))
// The panel has its own suite; here it only needs to show which app it was opened for.
vi.mock('@renderer/components/MiniApp/MiniAppDetailPanel', () => ({
  default: ({ appId, onClose }: { appId: string; onClose?: () => void }) => (
    <div role="dialog" aria-label="mini-app-detail" data-app-id={appId}>
      <button type="button" onClick={onClose}>
        close-detail
      </button>
    </div>
  )
}))

import MinimalToolbar from '../MinimalToolbar'

const localApp = {
  appId: 'com.example.game',
  kind: 'app',
  name: 'Game',
  url: 'cherry-miniapp://com.example.game/index.html'
} as unknown as MiniAppType
const site = { appId: 'google', kind: 'site', name: 'Google', url: 'https://google.com' } as unknown as MiniAppType

const renderToolbar = (app: MiniAppType) =>
  render(
    <MinimalToolbar
      app={app}
      webviewRef={{ current: null }}
      currentUrl={null}
      onReload={vi.fn()}
      onRestart={vi.fn()}
      onOpenDevTools={vi.fn()}
      splitMode="open"
      onSplit={vi.fn()}
    />
  )

afterEach(cleanup)

describe('MinimalToolbar', () => {
  it('invokes restart without reloading the current WebView', async () => {
    const user = userEvent.setup()
    const onReload = vi.fn()
    const onRestart = vi.fn()

    render(
      <MinimalToolbar
        app={site}
        webviewRef={{ current: null }}
        currentUrl={site.url}
        onReload={onReload}
        onRestart={onRestart}
        onOpenDevTools={vi.fn()}
        splitMode="open"
        onSplit={vi.fn()}
      />
    )

    await user.click(screen.getByRole('button', { name: /restart|重启/i }))

    expect(onRestart).toHaveBeenCalledOnce()
    expect(onReload).not.toHaveBeenCalled()
  })

  it('opens the same detail panel the launcher tile offers, for a local app only', () => {
    renderToolbar(localApp)
    fireEvent.click(screen.getByRole('button', { name: /view details|查看详情/i }))
    expect(screen.getByRole('dialog', { name: 'mini-app-detail' })).toHaveAttribute('data-app-id', 'com.example.game')

    fireEvent.click(screen.getByText('close-detail'))
    expect(screen.queryByRole('dialog')).toBeNull()

    cleanup()
    renderToolbar(site)
    expect(screen.queryByRole('button', { name: /view details|查看详情/i })).toBeNull()
  })

  it('offers the open-link-external switch to sites only', () => {
    // A local app can open nothing outside itself: the switch would describe a policy
    // the guest never gets.
    renderToolbar(localApp)
    expect(screen.queryByRole('button', { name: /open links|打开链接/i })).toBeNull()

    cleanup()
    renderToolbar(site)
    expect(screen.getByRole('button', { name: /open links|打开链接/i })).toBeInTheDocument()
  })

  it('shows DevTools for local apps and sites alike', () => {
    renderToolbar(localApp)
    expect(screen.getByRole('button', { name: /developer tools|开发者工具/i })).toBeInTheDocument()
    cleanup()
    renderToolbar(site)
    expect(screen.getByRole('button', { name: /developer tools|开发者工具/i })).toBeInTheDocument()
  })
})
