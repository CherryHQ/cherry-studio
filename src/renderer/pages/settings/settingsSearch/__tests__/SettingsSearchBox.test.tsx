import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import SettingsSearchBox from '../SettingsSearchBox'

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

  it('does nothing when the box is empty off the search page', () => {
    render(<SettingsSearchBox />)
    expect(routerMock.history.back).not.toHaveBeenCalled()
    expect(navigateMock).not.toHaveBeenCalled()
  })
})
