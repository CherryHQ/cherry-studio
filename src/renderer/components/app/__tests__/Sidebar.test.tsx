import { usePersistCache } from '@data/hooks/useCache'
import { usePreference } from '@data/hooks/usePreference'
import { fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import Sidebar from '../Sidebar'

vi.mock('@data/hooks/useCache', () => ({
  usePersistCache: vi.fn()
}))

vi.mock('@data/hooks/usePreference', () => ({
  usePreference: vi.fn()
}))

vi.mock('@renderer/config/env', () => ({
  AppLogo: 'app-logo.png'
}))

vi.mock('@renderer/hooks/useAvatar', () => ({
  default: () => ''
}))

vi.mock('@renderer/hooks/useTabs', () => ({
  useTabs: () => ({
    activeTab: { id: 'home', url: '/app/chat' },
    openTab: vi.fn(),
    updateTab: vi.fn()
  })
}))

vi.mock('@renderer/i18n/label', () => ({
  getSidebarIconLabel: (key: string) => key
}))

vi.mock('@renderer/utils/routeTitle', () => ({
  getDefaultRouteTitle: (path: string) => path
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key
  })
}))

vi.mock('../../Popups/UserPopup', () => ({
  default: { show: vi.fn() }
}))

vi.mock('../../Sidebar', () => ({
  Sidebar: ({ width, onResizePreview }: { width: number; onResizePreview?: (width: number | null) => void }) => (
    <div>
      <button type="button" data-testid="preview-80" onClick={() => onResizePreview?.(80)} />
      <button type="button" data-testid="preview-null" onClick={() => onResizePreview?.(null)} />
      <div data-testid="ui-sidebar" data-width={width} />
    </div>
  )
}))

describe('App Sidebar', () => {
  afterEach(() => {
    vi.clearAllMocks()
    document.documentElement.style.removeProperty('--sidebar-width')
  })

  it('normalizes persisted intermediate sidebar width to icon width', () => {
    const setSidebarWidth = vi.fn()

    vi.mocked(usePersistCache).mockReturnValue([80, setSidebarWidth])
    vi.mocked(usePreference).mockImplementation((key) => {
      if (key === 'ui.sidebar.icons.visible') return [[], vi.fn()] as never
      if (key === 'app.user.name') return ['', vi.fn()] as never
      return [undefined, vi.fn()] as never
    })

    render(<Sidebar />)

    expect(setSidebarWidth).toHaveBeenCalledWith(50)
  })

  it('uses the resize preview width for rendering and CSS variable without persisting it', () => {
    const setSidebarWidth = vi.fn()

    vi.mocked(usePersistCache).mockReturnValue([50, setSidebarWidth])
    vi.mocked(usePreference).mockImplementation((key) => {
      if (key === 'ui.sidebar.icons.visible') return [[], vi.fn()] as never
      if (key === 'app.user.name') return ['', vi.fn()] as never
      return [undefined, vi.fn()] as never
    })

    const { getByTestId } = render(<Sidebar />)

    expect(getByTestId('ui-sidebar')).toHaveAttribute('data-width', '50')
    expect(document.documentElement.style.getPropertyValue('--sidebar-width')).toBe('50px')

    fireEvent.click(getByTestId('preview-80'))

    expect(getByTestId('ui-sidebar')).toHaveAttribute('data-width', '80')
    expect(document.documentElement.style.getPropertyValue('--sidebar-width')).toBe('80px')
    expect(setSidebarWidth).not.toHaveBeenCalled()

    fireEvent.click(getByTestId('preview-null'))

    expect(getByTestId('ui-sidebar')).toHaveAttribute('data-width', '50')
    expect(document.documentElement.style.getPropertyValue('--sidebar-width')).toBe('50px')
  })
})
