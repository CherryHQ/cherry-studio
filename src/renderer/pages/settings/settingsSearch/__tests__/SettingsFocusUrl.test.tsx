import { render, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import SettingsFocusScroll from '../SettingsFocusScroll'
import SettingsFocusUrl from '../SettingsFocusUrl'
import { setPendingFocus, useSettingsSearchKeyboard } from '../store'

const { locationMock, navigateMock, searchMock } = vi.hoisted(() => ({
  locationMock: { pathname: '/settings/general' },
  navigateMock: vi.fn(),
  searchMock: {} as Record<string, unknown>
}))

vi.mock('@tanstack/react-router', () => ({
  useLocation: () => locationMock,
  useNavigate: () => navigateMock,
  // Fresh object per render (pessimistic vs TanStack structural sharing):
  // effect deps must survive reference changes and re-run safely
  useSearch: () => ({ ...searchMock })
}))

describe('SettingsFocusUrl', () => {
  beforeEach(() => {
    locationMock.pathname = '/settings/general'
    searchMock.q = undefined
    searchMock.focus = undefined
    navigateMock.mockReset()
    setPendingFocus(undefined)
  })

  const pendingFocusOf = () => renderHook(() => useSettingsSearchKeyboard()).result.current.pendingFocusId

  it('forwards a ?focus= anchor into the store and strips only that key', () => {
    searchMock.focus = 'setting-general-proxy'
    render(<SettingsFocusUrl />)

    expect(pendingFocusOf()).toBe('setting-general-proxy')
    expect(navigateMock).toHaveBeenCalledTimes(1)
    const call = navigateMock.mock.calls[0][0]
    expect(call.to).toBe('/settings/general')
    expect(call.replace).toBe(true)
    expect(call.search({ focus: 'setting-general-proxy', panel: 'data' })).toEqual({ panel: 'data' })
  })

  it('does nothing without a focus param', () => {
    render(<SettingsFocusUrl />)

    expect(pendingFocusOf()).toBeUndefined()
    expect(navigateMock).not.toHaveBeenCalled()
  })

  it('ignores a non-string focus value', () => {
    searchMock.focus = 42
    render(<SettingsFocusUrl />)

    expect(pendingFocusOf()).toBeUndefined()
    expect(navigateMock).not.toHaveBeenCalled()
  })

  it('ignores an empty-string focus (blank anchor must not reach the selector)', () => {
    searchMock.focus = ''
    render(<SettingsFocusUrl />)

    expect(pendingFocusOf()).toBeUndefined()
    expect(navigateMock).not.toHaveBeenCalled()
  })

  it('re-injects when focus reappears (second agent deep link into the same tab)', () => {
    searchMock.focus = 'setting-general-proxy'
    const view = render(<SettingsFocusUrl />)
    expect(navigateMock).toHaveBeenCalledTimes(1)
    expect(pendingFocusOf()).toBe('setting-general-proxy')

    // Strip landed; the next render sees a search without focus
    delete searchMock.focus
    view.rerender(<SettingsFocusUrl />)
    expect(navigateMock).toHaveBeenCalledTimes(1)

    // A second deep link reintroduces focus — one more injection
    searchMock.focus = 'setting-general-totray'
    view.rerender(<SettingsFocusUrl />)
    expect(navigateMock).toHaveBeenCalledTimes(2)
    expect(pendingFocusOf()).toBe('setting-general-totray')
  })

  it('strips focus while preserving other params (q coexistence)', () => {
    searchMock.q = 'proxy'
    searchMock.focus = 'setting-general-proxy'
    render(<SettingsFocusUrl />)

    const call = navigateMock.mock.calls[0][0]
    expect(call.search({ q: 'proxy', focus: 'setting-general-proxy' })).toEqual({ q: 'proxy' })
  })

  it('drives the scroll pipeline end to end from a URL focus', () => {
    const scope = document.createElement('div')
    document.body.appendChild(scope)
    const target = document.createElement('div')
    target.id = 'setting-general-proxy'
    scope.appendChild(target)
    Element.prototype.scrollIntoView = vi.fn()

    searchMock.focus = 'setting-general-proxy'
    render(
      <>
        <SettingsFocusUrl />
        <SettingsFocusScroll scopeRef={{ current: scope }} />
      </>
    )

    expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1)
    expect(target.classList.contains('search-hit-highlight')).toBe(true)
    expect(pendingFocusOf()).toBeUndefined()

    delete (Element.prototype as Partial<Element>).scrollIntoView
    document.body.innerHTML = ''
  })
})
