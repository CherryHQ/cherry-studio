// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  openTab: vi.fn(),
  setSidebarWidth: vi.fn(),
  showSearchPopup: vi.fn(),
  updateTab: vi.fn(),
  visibleSidebarIcons: ['assistants']
}))

vi.mock('@data/hooks/useCache', () => ({
  usePersistCache: () => [0, mocks.setSidebarWidth]
}))

vi.mock('@data/hooks/usePreference', () => ({
  usePreference: (key: string) => {
    if (key === 'app.user.name') return ['JD']
    if (key === 'ui.sidebar.icons.visible') return [mocks.visibleSidebarIcons]
    return [undefined]
  }
}))

vi.mock('@renderer/config/env', () => ({
  AppLogo: 'logo.png'
}))

vi.mock('@renderer/config/sidebar', () => ({
  getOrderedVisibleSidebarIcons: (icons: string[]) => icons,
  getSidebarMenuPath: (icon: string) => `/app/${icon}`,
  resolveSidebarActiveItem: () => 'assistants',
  SIDEBAR_ICON_COMPONENTS: {
    agents: () => <span data-testid="agents-icon" />,
    assistants: () => <span data-testid="assistants-icon" />,
    translate: () => <span data-testid="translate-icon" />
  }
}))

vi.mock('@renderer/hooks/useAvatar', () => ({
  default: () => undefined
}))

vi.mock('@renderer/hooks/useSettings', () => ({
  useSettings: () => ({ defaultPaintingProvider: undefined })
}))

vi.mock('@renderer/i18n/label', () => ({
  getSidebarIconLabel: (icon: string) =>
    ({
      agents: 'Agent',
      assistants: 'Chat',
      translate: 'Translate'
    })[icon]
}))

vi.mock('@renderer/utils/routeTitle', () => ({
  getDefaultRouteTitle: () => 'Chat'
}))

vi.mock('../../../hooks/useTabs', () => ({
  useTabs: () => ({
    activeTab: {
      id: 'chat',
      type: 'route',
      url: '/app/chat',
      title: 'Chat'
    },
    openTab: mocks.openTab,
    updateTab: mocks.updateTab
  })
}))

vi.mock('../../Popups/SearchPopup', () => ({
  default: {
    show: mocks.showSearchPopup
  }
}))

vi.mock('../../Popups/UserPopup', () => ({
  default: {
    show: vi.fn()
  }
}))

vi.mock('../../Icons/SVGIcon', () => ({
  OpenClawSidebarIcon: () => null
}))

vi.mock('../../Sidebar', () => ({
  Sidebar: ({
    isFloating,
    isFloatingClosing,
    onDismiss,
    onHoverChange,
    items,
    onSearchClick,
    searchLabel
  }: {
    isFloating?: boolean
    isFloatingClosing?: boolean
    items?: Array<{ id: string; label: string }>
    onDismiss?: () => void
    onHoverChange?: (hovering: boolean) => void
    onSearchClick?: () => void
    searchLabel?: string
  }) =>
    isFloating ? (
      <div
        className={isFloatingClosing ? 'slide-out-to-left-2 animate-out' : 'slide-in-from-left-2 animate-in'}
        data-testid="floating-sidebar">
        <button type="button" onClick={onDismiss}>
          dismiss
        </button>
      </div>
    ) : (
      <>
        <button type="button" onClick={() => onHoverChange?.(true)}>
          reveal
        </button>
        <button type="button" onClick={onSearchClick}>
          {searchLabel}
        </button>
        <div data-testid="sidebar-items">
          {items?.map((item) => (
            <span key={item.id}>{item.label}</span>
          ))}
        </div>
      </>
    )
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => {
      if (key === 'common.search') return 'Search'
      return options?.defaultValue ?? key
    }
  })
}))

import Sidebar from '../Sidebar'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  mocks.visibleSidebarIcons = ['assistants']
  vi.useRealTimers()
})

describe('app Sidebar', () => {
  it('keeps the floating sidebar mounted for its closing animation before unmounting', () => {
    vi.useFakeTimers()
    render(<Sidebar />)

    fireEvent.click(screen.getByRole('button', { name: 'reveal' }))
    expect(screen.getByTestId('floating-sidebar')).toHaveClass('animate-in', 'slide-in-from-left-2')

    fireEvent.click(screen.getByRole('button', { name: 'dismiss' }))
    expect(screen.getByTestId('floating-sidebar')).toHaveClass('animate-out', 'slide-out-to-left-2')

    act(() => {
      vi.advanceTimersByTime(199)
    })
    expect(screen.getByTestId('floating-sidebar')).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(screen.queryByTestId('floating-sidebar')).not.toBeInTheDocument()
  })

  it('opens global search from the sidebar search entry', async () => {
    const user = userEvent.setup()

    render(<Sidebar />)

    await user.click(screen.getByRole('button', { name: 'Search' }))

    expect(mocks.showSearchPopup).toHaveBeenCalledWith({ hideQuickApps: true })
  })

  it('renders sidebar menu items in visible preference order', () => {
    mocks.visibleSidebarIcons = ['translate', 'assistants', 'agents']

    render(<Sidebar />)

    const labels = Array.from(screen.getByTestId('sidebar-items').querySelectorAll('span')).map(
      (element) => element.textContent
    )
    expect(labels).toEqual(['Translate', 'Chat', 'Agent'])
  })
})
