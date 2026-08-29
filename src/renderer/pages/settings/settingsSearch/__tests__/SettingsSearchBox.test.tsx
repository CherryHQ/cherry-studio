import { fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import SettingsSearchBox from '../SettingsSearchBox'
import { setLiveQuery, useSettingsSearchKeyboard } from '../store'

const { locationMock, navigateMock, routerMock, searchMock } = vi.hoisted(() => ({
  locationMock: { pathname: '/settings/general' },
  navigateMock: vi.fn(),
  routerMock: {
    history: { canGoBack: vi.fn(() => true), back: vi.fn() }
  },
  searchMock: {} as Record<string, unknown>
}))

vi.mock('@tanstack/react-router', () => ({
  useLocation: () => locationMock,
  useNavigate: () => navigateMock,
  useRouter: () => routerMock,
  useSearch: () => searchMock
}))

vi.mock('@cherrystudio/ui', () => ({
  SearchInput: ({
    value,
    onChange,
    onKeyDown
  }: {
    value: string
    onChange: (e: { target: { value: string } }) => void
    onKeyDown: (e: { key: string; preventDefault: () => void }) => void
  }) => <input data-testid="search-input" value={value} onChange={onChange} onKeyDown={onKeyDown} />
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

describe('SettingsSearchBox', () => {
  beforeEach(() => {
    locationMock.pathname = '/settings/general'
    searchMock.q = undefined
    navigateMock.mockReset()
    routerMock.history.back.mockReset()
    routerMock.history.canGoBack.mockReturnValue(true)
    setLiveQuery(undefined)
  })

  it('does not walk history back when a deep-link dispatch lands on the search page', async () => {
    const view = render(<SettingsSearchBox />)

    // External dispatch navigates to /settings/search?q= while the input is
    // still empty — the seed setValue is in flight for one effect pass
    locationMock.pathname = '/settings/search'
    searchMock.q = 'proxy'
    view.rerender(<SettingsSearchBox />)

    expect(routerMock.history.back).not.toHaveBeenCalled()

    // The seeded query flows through the debounce into a navigate
    await waitFor(
      () => expect(navigateMock).toHaveBeenCalledWith(expect.objectContaining({ to: '/settings/search' })),
      { timeout: 1000 }
    )
  })

  it('goes back when the user clears the box while on the search page', () => {
    locationMock.pathname = '/settings/search'
    searchMock.q = 'proxy'
    render(<SettingsSearchBox />)

    const input = screen.getByTestId('search-input')
    expect((input as HTMLInputElement).value).toBe('proxy')

    fireEvent.change(input, { target: { value: '' } })

    expect(routerMock.history.back).toHaveBeenCalled()
  })

  it('follows external ?q= updates within the same search tab', () => {
    locationMock.pathname = '/settings/search'
    searchMock.q = 'proxy'
    const view = render(<SettingsSearchBox />)
    const input = screen.getByTestId('search-input')
    expect((input as HTMLInputElement).value).toBe('proxy')

    // Same pathname, only the query param changes (history back/forward,
    // another deep link) — the input must track the URL
    searchMock.q = 'theme'
    view.rerender(<SettingsSearchBox />)

    expect((input as HTMLInputElement).value).toBe('theme')
  })

  it('publishes keystrokes to the live query store immediately (pre-debounce)', () => {
    render(<SettingsSearchBox />)
    const { result } = renderHook(() => useSettingsSearchKeyboard())

    fireEvent.change(screen.getByTestId('search-input'), { target: { value: 'pro' } })

    // Before any debounced navigation: Enter must already jump on 'pro'
    expect(result.current.liveQuery).toBe('pro')
    expect(navigateMock).not.toHaveBeenCalled()
  })

  it('releases the live query on unmount (hidden tab must not leak it)', () => {
    locationMock.pathname = '/settings/search'
    searchMock.q = 'proxy'
    const { result } = renderHook(() => useSettingsSearchKeyboard())
    const { unmount } = render(<SettingsSearchBox />)

    fireEvent.change(screen.getByTestId('search-input'), { target: { value: 'pro' } })
    expect(result.current.liveQuery).toBe('pro')

    unmount()
    // Store is window-global across tabs: a hidden tab falls back to its URL
    expect(result.current.liveQuery).toBeUndefined()
  })

  it('does nothing when the box is empty off the search page', () => {
    render(<SettingsSearchBox />)
    expect(routerMock.history.back).not.toHaveBeenCalled()
    expect(navigateMock).not.toHaveBeenCalled()
  })
})
