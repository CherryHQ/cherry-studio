import { MockCacheUtils } from '@test-mocks/renderer/CacheService'
import { fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { cacheService } from '@data/CacheService'

import Sidebar from '../Sidebar'

vi.unmock('@cherrystudio/ui')
vi.unmock('@data/hooks/useCache')

vi.mock('@renderer/hooks/useSidebarShortcuts', () => ({
  useSidebarShortcuts: () => ({ shortcuts: [], remove: vi.fn(), reorder: vi.fn() })
}))
vi.mock('../sidebarShortcuts', () => ({
  useSidebarNavigationSnapshot: () => ({ url: '/' }),
  useResolvedSidebarShortcuts: () => [],
  useSidebarShortcutActivation: () => vi.fn(),
  useSidebarShortcutRegistry: () => ({ resolve: vi.fn() })
}))
vi.mock('../../UserAccountPanel', () => ({ UserAccountPanel: () => null }))
vi.mock('../../layout/HelpMenu', () => ({ HelpMenu: () => null }))
vi.mock('../../layout/ShellTabBarActions', () => ({
  AppUpdateButton: () => null,
  SidebarSettingsButton: () => null
}))

beforeEach(() => {
  MockCacheUtils.resetMocks()
})

afterEach(() => {
  fireEvent.mouseUp(document)
  document.documentElement.style.removeProperty('--sidebar-width')
})

describe('app Sidebar continuous resize', () => {
  it.each([
    { name: 'hidden through icon width', startWidth: 0, firstMove: 25, previewWidth: 50 },
    { name: 'hidden through an intermediate preview', startWidth: 0, firstMove: 80, previewWidth: 80 },
    { name: 'full through hidden width', startWidth: 170, firstMove: 10, previewWidth: 0 }
  ])('continues dragging from $name until release', ({ startWidth, firstMove, previewWidth }) => {
    cacheService.setPersist('ui.sidebar.width', startWidth)
    const { container } = render(<Sidebar />)
    const resizeHandle = container.querySelector<HTMLElement>('.cursor-col-resize')!

    fireEvent.mouseDown(resizeHandle, { clientX: startWidth })
    fireEvent.mouseMove(document, { clientX: firstMove })

    // The shell width must follow the drag across hidden, icon, and preview layouts.
    expect(document.documentElement.style.getPropertyValue('--sidebar-width')).toBe(`${previewWidth}px`)

    fireEvent.mouseMove(document, { clientX: 170 })
    expect(document.documentElement.style.getPropertyValue('--sidebar-width')).toBe('170px')

    fireEvent.mouseUp(document)
    expect(cacheService.getPersist('ui.sidebar.width')).toBe(170)

    fireEvent.mouseMove(document, { clientX: 240 })
    expect(document.documentElement.style.getPropertyValue('--sidebar-width')).toBe('170px')
    expect(cacheService.getPersist('ui.sidebar.width')).toBe(170)
  })
})
