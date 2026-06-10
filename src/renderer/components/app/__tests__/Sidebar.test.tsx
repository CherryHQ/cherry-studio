import { usePersistCache } from '@data/hooks/useCache'
import { fireEvent, render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { MockUseCacheUtils } from '../../../../../tests/__mocks__/renderer/useCache'
import { MockUsePreferenceUtils } from '../../../../../tests/__mocks__/renderer/usePreference'
import Sidebar from '../Sidebar'

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

// Total writes through the setters returned for the 'ui.sidebar.width' key,
// across every render of the component.
function countSidebarWidthWrites() {
  const mocked = vi.mocked(usePersistCache)
  return mocked.mock.calls.reduce((total, call, index) => {
    if (call[0] !== 'ui.sidebar.width') return total
    const result = mocked.mock.results[index]
    if (result.type !== 'return') return total
    const [, setValue] = result.value as [unknown, ReturnType<typeof vi.fn>]
    return total + setValue.mock.calls.length
  }, 0)
}

describe('App Sidebar', () => {
  beforeEach(() => {
    MockUseCacheUtils.resetMocks()
    MockUsePreferenceUtils.resetMocks()
    MockUsePreferenceUtils.setPreferenceValue('ui.sidebar.icons.visible', ['assistants'])
    document.documentElement.style.removeProperty('--sidebar-width')
  })

  it('migrates a persisted intermediate sidebar width to icon width and converges', () => {
    MockUseCacheUtils.setPersistCacheValue('ui.sidebar.width', 80)

    const { rerender } = render(<Sidebar />)

    expect(MockUseCacheUtils.getPersistCacheValue('ui.sidebar.width')).toBe(50)
    expect(countSidebarWidthWrites()).toBe(1)

    rerender(<Sidebar />)

    expect(MockUseCacheUtils.getPersistCacheValue('ui.sidebar.width')).toBe(50)
    expect(countSidebarWidthWrites()).toBe(1)
  })

  it('uses the resize preview width for rendering and CSS variable without persisting it', () => {
    const { getByTestId } = render(<Sidebar />)

    expect(getByTestId('ui-sidebar')).toHaveAttribute('data-width', '50')
    expect(document.documentElement.style.getPropertyValue('--sidebar-width')).toBe('50px')

    fireEvent.click(getByTestId('preview-80'))

    expect(getByTestId('ui-sidebar')).toHaveAttribute('data-width', '80')
    expect(document.documentElement.style.getPropertyValue('--sidebar-width')).toBe('80px')
    expect(MockUseCacheUtils.getPersistCacheValue('ui.sidebar.width')).toBe(50)
    expect(countSidebarWidthWrites()).toBe(0)

    fireEvent.click(getByTestId('preview-null'))

    expect(getByTestId('ui-sidebar')).toHaveAttribute('data-width', '50')
    expect(document.documentElement.style.getPropertyValue('--sidebar-width')).toBe('50px')
  })
})
