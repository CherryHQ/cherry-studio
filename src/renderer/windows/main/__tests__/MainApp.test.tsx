import '@testing-library/jest-dom/vitest'

import type { Tab } from '@shared/data/cache/cacheValueTypes'
import { IpcChannel } from '@shared/IpcChannel'
import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const onboardingModule = vi.hoisted(() => ({ evaluations: 0 }))
const mainWindowMocks = vi.hoisted(() => ({
  activeTab: undefined as Tab | undefined,
  ipcListeners: new Map<string, (_event: unknown, text: string) => void>(),
  ipcOn: vi.fn(),
  openTab: vi.fn(),
  reconcileTabs: vi.fn(),
  routeSelectionQuoteToChat: vi.fn(),
  setActiveTab: vi.fn(),
  tabs: [] as Tab[],
  unsubscribe: vi.fn(),
  updateTab: vi.fn()
}))

vi.mock('../onboarding/OnboardingPage', () => {
  onboardingModule.evaluations += 1
  return { default: () => <div data-testid="onboarding-page">onboarding</div> }
})

vi.mock('../privacy/PrivacyPolicyUpdateGate', () => ({
  PrivacyPolicyUpdateGate: () => <div data-testid="privacy-policy-gate">privacy-policy-gate</div>
}))

vi.mock('@renderer/components/layout/TabsProvider', () => ({
  TabsProvider: ({ children }: { children: ReactNode }) => <div data-testid="tabs-provider">{children}</div>
}))

vi.mock('@renderer/components/layout/AppShell', () => ({
  AppShell: () => <div data-testid="app-shell">app-shell</div>
}))

vi.mock('@renderer/hooks/tab', () => ({
  useMainWindowNavigation: () => {},
  useTabs: () => ({
    activeTab: mainWindowMocks.activeTab,
    openTab: mainWindowMocks.openTab,
    setActiveTab: mainWindowMocks.setActiveTab,
    tabs: mainWindowMocks.tabs,
    updateTab: mainWindowMocks.updateTab
  })
}))

vi.mock('@renderer/services/SelectionQuoteService', () => ({
  routeSelectionQuoteToChat: mainWindowMocks.routeSelectionQuoteToChat,
  selectionQuoteService: { reconcileTabs: mainWindowMocks.reconcileTabs }
}))

vi.mock('@renderer/hooks/useWindowRuntime', () => ({ useWindowRuntime: () => {} }))
vi.mock('@renderer/hooks/useStorageMonitorNotification', () => ({ useStorageMonitorNotification: () => {} }))
vi.mock('@renderer/components/ConversationNotificationRuntime', () => ({
  ConversationNotificationRuntime: () => null
}))
vi.mock('../hooks/useAutoBackupEvents', () => ({ useAutoBackupEvents: () => {} }))
vi.mock('../hooks/useTopicNamingErrorNotification', () => ({ useTopicNamingErrorNotification: () => {} }))
vi.mock('../hooks/useAppUpdateHandler', () => ({ useAppUpdateHandler: () => {} }))
vi.mock('@renderer/components/PopupHost', () => ({ PopupHost: () => null }))
vi.mock('@renderer/components/ToastHost', () => ({ default: () => null }))
vi.mock('@renderer/components/ThemeProvider', () => ({
  ThemeProvider: () => {
    throw new Error('theme provider boom')
  }
}))

import MainApp, { MainWindowContent } from '../MainApp'

function appendBootSpinner() {
  const spinner = document.createElement('div')
  spinner.id = 'spinner'
  document.body.appendChild(spinner)
}

describe('MainWindowContent', () => {
  beforeEach(() => {
    MockUsePreferenceUtils.resetMocks()
    mainWindowMocks.activeTab = undefined
    mainWindowMocks.tabs = []
    mainWindowMocks.ipcListeners.clear()
    mainWindowMocks.ipcOn.mockImplementation((channel: string, listener: (_event: unknown, text: string) => void) => {
      mainWindowMocks.ipcListeners.set(channel, listener)
      return () => {
        mainWindowMocks.unsubscribe()
        if (mainWindowMocks.ipcListeners.get(channel) === listener) {
          mainWindowMocks.ipcListeners.delete(channel)
        }
      }
    })
    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: { ipcRenderer: { on: mainWindowMocks.ipcOn } }
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('does not load onboarding after first-run setup is completed or skipped', () => {
    for (const status of ['completed', 'skipped'] as const) {
      MockUsePreferenceUtils.setPreferenceValue('app.onboarding.provider_setup.status', status)

      const view = render(<MainWindowContent />)

      expect(screen.getByTestId('tabs-provider')).toBeInTheDocument()
      expect(screen.getByTestId('app-shell')).toBeInTheDocument()
      expect(screen.queryByTestId('onboarding-page')).not.toBeInTheDocument()
      expect(screen.getByTestId('privacy-policy-gate')).toBeInTheDocument()
      expect(onboardingModule.evaluations).toBe(0)
      view.unmount()
    }
  })

  it('loads and renders onboarding before the user completes first-run setup', async () => {
    MockUsePreferenceUtils.setPreferenceValue('app.onboarding.provider_setup.status', 'pending')
    appendBootSpinner()

    render(<MainWindowContent />)

    expect(await screen.findByTestId('onboarding-page')).toBeInTheDocument()
    expect(onboardingModule.evaluations).toBe(1)
    expect(screen.queryByTestId('app-shell')).not.toBeInTheDocument()
    expect(screen.queryByTestId('privacy-policy-gate')).not.toBeInTheDocument()
    expect(document.getElementById('spinner')).toBeNull()
  })

  it('subscribes to main-window selection quotes and routes them through the tab owner', () => {
    MockUsePreferenceUtils.setPreferenceValue('app.onboarding.provider_setup.status', 'completed')

    const view = render(<MainWindowContent />)

    expect(mainWindowMocks.ipcOn).toHaveBeenCalledWith(IpcChannel.App_QuoteToMain, expect.any(Function))

    mainWindowMocks.ipcListeners.get(IpcChannel.App_QuoteToMain)?.({}, 'Selected message text')

    expect(mainWindowMocks.routeSelectionQuoteToChat).toHaveBeenCalledWith({
      activeTab: undefined,
      openTab: mainWindowMocks.openTab,
      request: { id: expect.any(String), text: 'Selected message text' },
      setActiveTab: mainWindowMocks.setActiveTab,
      tabs: [],
      updateTab: mainWindowMocks.updateTab
    })

    view.unmount()
    expect(mainWindowMocks.unsubscribe).toHaveBeenCalled()
    expect(mainWindowMocks.ipcListeners.has(IpcChannel.App_QuoteToMain)).toBe(false)
  })

  it('keeps one quote subscription while routing with the latest tab state', () => {
    MockUsePreferenceUtils.setPreferenceValue('app.onboarding.provider_setup.status', 'completed')
    const view = render(<MainWindowContent />)
    const listener = mainWindowMocks.ipcListeners.get(IpcChannel.App_QuoteToMain)
    const chatTab: Tab = {
      id: 'chat-tab',
      type: 'route',
      url: '/app/chat?topicId=topic-1',
      title: 'Chat',
      isDormant: false
    }

    mainWindowMocks.activeTab = chatTab
    mainWindowMocks.tabs = [chatTab]
    view.rerender(<MainWindowContent />)
    listener?.({}, 'Latest selected text')

    expect(mainWindowMocks.ipcOn).toHaveBeenCalledOnce()
    expect(mainWindowMocks.routeSelectionQuoteToChat).toHaveBeenLastCalledWith(
      expect.objectContaining({ activeTab: chatTab, tabs: [chatTab] })
    )
  })
})

describe('MainApp top-level error boundary', () => {
  it('shows the window fatal fallback instead of a white screen when a provider throws', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    appendBootSpinner()

    render(<MainApp />)

    expect(screen.getByRole('alert')).toHaveTextContent('theme provider boom')
    expect(document.getElementById('spinner')).toBeNull()
    consoleError.mockRestore()
  })
})
