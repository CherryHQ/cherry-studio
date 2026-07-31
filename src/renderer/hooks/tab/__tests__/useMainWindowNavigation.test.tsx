// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  openTab: vi.fn(),
  initData: null as { kind: 'navigation'; to: string; requestId: number } | null,
  ipcListeners: new Map<string, (payload: unknown) => void>(),
  ipcRequest: vi.fn()
}))

vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: mocks.ipcRequest },
  useIpcOn: (event: string, handler: (payload: unknown) => void) => {
    mocks.ipcListeners.set(event, handler)
  }
}))

vi.mock('@renderer/hooks/useWindowInitData', () => ({
  useWindowInitData: () => mocks.initData
}))

vi.mock('../useTabs', () => ({
  useTabs: () => ({
    openTab: mocks.openTab
  })
}))

import { OPEN_MAIN_ROUTE_EVENT } from '@renderer/services/mainWindowNavigation'

import { useMainWindowNavigation } from '../useMainWindowNavigation'

function MainWindowNavigationHarness() {
  const { settingsPath, closeSettings } = useMainWindowNavigation()

  return (
    <>
      <output data-testid="settings-path">{settingsPath ?? 'closed'}</output>
      <button type="button" onClick={closeSettings}>
        Close settings
      </button>
    </>
  )
}

function dispatchMainRoute(path: string) {
  const event = new CustomEvent(OPEN_MAIN_ROUTE_EVENT, {
    cancelable: true,
    detail: { path }
  })
  void act(() => window.dispatchEvent(event))
  return event
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  mocks.initData = null
  mocks.ipcListeners.clear()
})

describe('useMainWindowNavigation', () => {
  it('announces readiness after mounting the navigation listeners', () => {
    render(<MainWindowNavigationHarness />)

    expect(mocks.ipcListeners.has('navigation.open_route_requested')).toBe(true)
    expect(mocks.ipcRequest).toHaveBeenCalledWith('navigation.protocol_dispatch_ready')
  })

  it('opens Settings as application-level state without creating a workspace tab', () => {
    render(<MainWindowNavigationHarness />)

    const event = dispatchMainRoute('/settings/provider?id=openai')

    expect(event.defaultPrevented).toBe(true)
    expect(screen.getByTestId('settings-path')).toHaveTextContent('/settings/provider?id=openai')
    expect(mocks.openTab).not.toHaveBeenCalled()
  })

  it('treats the Settings index route as the immersive surface instead of a workspace tab', () => {
    render(<MainWindowNavigationHarness />)

    dispatchMainRoute('/settings')

    expect(screen.getByTestId('settings-path')).toHaveTextContent('/settings')
    expect(mocks.openTab).not.toHaveBeenCalled()
  })

  it('reuses the Settings surface for consecutive requests', () => {
    render(<MainWindowNavigationHarness />)

    dispatchMainRoute('/settings/provider')
    dispatchMainRoute('/settings/about')

    expect(screen.getByTestId('settings-path')).toHaveTextContent('/settings/about')
    expect(mocks.openTab).not.toHaveBeenCalled()
  })

  it('closes Settings without navigating the workspace', () => {
    render(<MainWindowNavigationHarness />)

    dispatchMainRoute('/settings/appearance')
    fireEvent.click(screen.getByRole('button', { name: 'Close settings' }))

    expect(screen.getByTestId('settings-path')).toHaveTextContent('closed')
    expect(mocks.openTab).not.toHaveBeenCalled()
  })

  it('opens Settings from main-window init data and acknowledges it so it is not replayed after remount', () => {
    mocks.initData = { kind: 'navigation', to: '/settings/about', requestId: 1 }
    mocks.ipcRequest.mockImplementation((channel: string) => {
      if (channel === 'navigation.ack_open_route') mocks.initData = null
    })
    const { unmount } = render(<MainWindowNavigationHarness />)

    expect(screen.getByTestId('settings-path')).toHaveTextContent('/settings/about')
    expect(mocks.openTab).not.toHaveBeenCalled()
    expect(mocks.ipcRequest).toHaveBeenCalledWith('navigation.ack_open_route', { requestId: 1 })

    unmount()
    render(<MainWindowNavigationHarness />)
    expect(screen.getByTestId('settings-path')).toHaveTextContent('closed')
  })

  it('opens a regular tab for non-settings navigation init data', () => {
    mocks.initData = { kind: 'navigation', to: '/agents', requestId: 1 }
    render(<MainWindowNavigationHarness />)

    expect(mocks.openTab).toHaveBeenCalledWith('/agents')
    expect(screen.getByTestId('settings-path')).toHaveTextContent('closed')
  })

  it('opens a regular tab when a non-settings IPC event arrives', () => {
    render(<MainWindowNavigationHarness />)

    act(() => mocks.ipcListeners.get('navigation.open_route_requested')?.({ to: '/knowledge' }))

    expect(mocks.openTab).toHaveBeenCalledWith('/knowledge')
  })

  it('routes a Settings IPC event through the same immersive surface', () => {
    render(<MainWindowNavigationHarness />)

    act(() => mocks.ipcListeners.get('navigation.open_route_requested')?.({ to: '/settings/about' }))

    expect(screen.getByTestId('settings-path')).toHaveTextContent('/settings/about')
    expect(mocks.openTab).not.toHaveBeenCalled()
  })

  it('leaves Settings when a regular route request arrives', () => {
    render(<MainWindowNavigationHarness />)

    dispatchMainRoute('/settings/provider')
    dispatchMainRoute('/agents')

    expect(screen.getByTestId('settings-path')).toHaveTextContent('closed')
    expect(mocks.openTab).toHaveBeenCalledWith('/agents')
  })

  it('does not replay the same init-data request after Settings state changes', () => {
    const { rerender } = render(<MainWindowNavigationHarness />)

    mocks.initData = { kind: 'navigation', to: '/settings/provider', requestId: 1 }
    rerender(<MainWindowNavigationHarness />)
    fireEvent.click(screen.getByRole('button', { name: 'Close settings' }))
    rerender(<MainWindowNavigationHarness />)

    expect(screen.getByTestId('settings-path')).toHaveTextContent('closed')
    expect(mocks.openTab).not.toHaveBeenCalled()
  })

  it('removes the main-route event bridge on unmount', () => {
    const { unmount } = render(<MainWindowNavigationHarness />)
    unmount()

    const event = new CustomEvent(OPEN_MAIN_ROUTE_EVENT, {
      cancelable: true,
      detail: { path: '/agents' }
    })
    window.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(false)
    expect(mocks.openTab).not.toHaveBeenCalled()
  })
})
