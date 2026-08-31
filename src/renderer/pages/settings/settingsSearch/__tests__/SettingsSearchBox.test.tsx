import { fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import { Activity } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import SettingsSearchBox from '../SettingsSearchBox'
import { SettingsSearchDomIdsProvider, useSettingsSearchDomIds } from '../SettingsSearchDomIds'
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
    onKeyDown,
    'aria-controls': ariaControls,
    'aria-activedescendant': ariaActivedescendant
  }: {
    value: string
    onChange: (e: { target: { value: string } }) => void
    onKeyDown: (e: { key: string; preventDefault: () => void }) => void
    'aria-controls'?: string
    'aria-activedescendant'?: string
  }) => (
    <input
      data-testid="search-input"
      value={value}
      onChange={onChange}
      onKeyDown={onKeyDown}
      aria-controls={ariaControls}
      aria-activedescendant={ariaActivedescendant}
    />
  )
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

  it('pushes a fresh history entry for the first search after an empty-value exit', async () => {
    locationMock.pathname = '/settings/search'
    searchMock.q = 'proxy'
    const view = render(<SettingsSearchBox />)
    const input = screen.getByTestId('search-input')

    // Clearing on the search page walks history back off it; the box is empty
    fireEvent.change(input, { target: { value: '' } })
    expect(routerMock.history.back).toHaveBeenCalled()

    // Landing on another section with the box still empty — then searching
    locationMock.pathname = '/settings/general'
    searchMock.q = undefined
    view.rerender(<SettingsSearchBox />)

    fireEvent.change(input, { target: { value: 'theme' } })
    // replace:false is the contract: back must return to the origin section
    await waitFor(
      () =>
        expect(navigateMock).toHaveBeenCalledWith(
          expect.objectContaining({ to: '/settings/search', search: { q: 'theme' }, replace: false })
        ),
      { timeout: 1000 }
    )
  })

  it('replaces, not pushes, the mirrored navigate after a back/forward re-entry', async () => {
    const view = render(<SettingsSearchBox />)
    const input = screen.getByTestId('search-input')

    // First session on general pushes the search entry
    fireEvent.change(input, { target: { value: 'proxy' } })
    await waitFor(() => expect(navigateMock).toHaveBeenCalledTimes(1), { timeout: 1000 })

    // The push lands; jumping to a result leaves, then browser-forward returns
    locationMock.pathname = '/settings/search'
    searchMock.q = 'proxy'
    view.rerender(<SettingsSearchBox />)
    locationMock.pathname = '/settings/provider'
    searchMock.q = undefined
    view.rerender(<SettingsSearchBox />)
    locationMock.pathname = '/settings/search'
    searchMock.q = 'proxy'
    view.rerender(<SettingsSearchBox />)

    // The URL seed re-fires the debounced mirror — landing on an existing
    // entry again must replace it, not push a duplicate behind it
    await waitFor(() => expect(navigateMock).toHaveBeenCalledTimes(2), { timeout: 1000 })
    expect(navigateMock).toHaveBeenLastCalledWith(expect.objectContaining({ replace: true }))
  })

  it('leaves exactly once on Escape (the empty-pass must not navigate again)', () => {
    locationMock.pathname = '/settings/search'
    searchMock.q = 'proxy'
    render(<SettingsSearchBox />)

    fireEvent.keyDown(screen.getByTestId('search-input'), { key: 'Escape' })

    // exitSearch's back() and the debounced empty-pass race: one clear, one leave
    expect(routerMock.history.back).toHaveBeenCalledTimes(1)
    expect(navigateMock).not.toHaveBeenCalled()
  })

  it('fires the fallback navigation only once when back is unavailable', () => {
    routerMock.history.canGoBack.mockReturnValue(false)
    locationMock.pathname = '/settings/search'
    searchMock.q = 'proxy'
    render(<SettingsSearchBox />)

    fireEvent.keyDown(screen.getByTestId('search-input'), { key: 'Escape' })

    expect(navigateMock).toHaveBeenCalledTimes(1)
    expect(navigateMock).toHaveBeenCalledWith(expect.objectContaining({ to: '/settings/general' }))
  })

  it('keeps input typed during the hide window across an <Activity> show', () => {
    locationMock.pathname = '/settings/search'
    searchMock.q = 'proxy'
    const { result } = renderHook(() => useSettingsSearchKeyboard())
    const view = render(
      <Activity mode="visible">
        <SettingsSearchBox />
      </Activity>
    )
    const input = screen.getByTestId('search-input')

    // Type within the debounce window, then the tab is hidden mid-flight
    fireEvent.change(input, { target: { value: 'theme' } })
    view.rerender(
      <Activity mode="hidden">
        <SettingsSearchBox />
      </Activity>
    )
    view.rerender(
      <Activity mode="visible">
        <SettingsSearchBox />
      </Activity>
    )

    // The URL mirror is still q=proxy; the surviving input must win
    expect((input as HTMLInputElement).value).toBe('theme')
    // Re-show re-publishes the surviving input to the window-global store
    expect(result.current.liveQuery).toBe('theme')
  })

  it('still follows a genuine external ?q= change after an <Activity> re-show', () => {
    locationMock.pathname = '/settings/search'
    searchMock.q = 'proxy'
    const view = render(
      <Activity mode="visible">
        <SettingsSearchBox />
      </Activity>
    )
    view.rerender(
      <Activity mode="hidden">
        <SettingsSearchBox />
      </Activity>
    )
    view.rerender(
      <Activity mode="visible">
        <SettingsSearchBox />
      </Activity>
    )

    // The re-show guard must only skip UNCHANGED urlQuery values — a real
    // external update (back/forward, deep link) still overrides the box
    searchMock.q = 'theme'
    view.rerender(
      <Activity mode="visible">
        <SettingsSearchBox />
      </Activity>
    )

    expect(screen.getByTestId<HTMLInputElement>('search-input').value).toBe('theme')
  })

  it('wires aria-controls to the shared per-instance listbox id', () => {
    locationMock.pathname = '/settings/search'
    searchMock.q = 'proxy'
    render(
      <SettingsSearchDomIdsProvider>
        <SettingsSearchBox />
      </SettingsSearchDomIdsProvider>
    )
    const listboxId = screen.getByTestId('search-input').getAttribute('aria-controls')
    // Not the legacy window-global constant: two tabs must not share one id
    expect(listboxId).toMatch(/^settings-search-listbox-/)
    expect(listboxId).not.toBe('settings-search-results-listbox')
  })

  it('shares one id set between the box and a results-listbox consumer', () => {
    locationMock.pathname = '/settings/search'
    searchMock.q = 'proxy'
    const ListboxProbe = () => {
      const { listboxId } = useSettingsSearchDomIds()
      return <div role="listbox" id={listboxId} data-testid="probe-listbox" />
    }
    render(
      <SettingsSearchDomIdsProvider>
        <SettingsSearchBox />
        <ListboxProbe />
      </SettingsSearchDomIdsProvider>
    )

    // Same provider tree: the combobox must reference the listbox's own id,
    // not a fallback (box on provider, listbox on fallback would pass neither)
    expect(screen.getByTestId('search-input').getAttribute('aria-controls')).toBe(
      screen.getByTestId('probe-listbox').id
    )
  })
})
