import { act, render, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import SettingsFocusScroll from '../SettingsFocusScroll'
import { setPendingFocus, useSettingsSearchKeyboard } from '../store'

const { locationMock } = vi.hoisted(() => ({ locationMock: { pathname: '/settings/general' } }))

vi.mock('@tanstack/react-router', () => ({
  useLocation: () => locationMock
}))

describe('SettingsFocusScroll', () => {
  let scope: HTMLDivElement

  beforeEach(() => {
    vi.useFakeTimers()
    locationMock.pathname = '/settings/general'
    // jsdom has no layout (scrollIntoView is not even defined); the call is the contract
    Element.prototype.scrollIntoView = vi.fn()
    setPendingFocus(undefined)
    // The settings content column of THIS tab; the lookup must stay inside it
    scope = document.createElement('div')
    document.body.appendChild(scope)
  })

  afterEach(() => {
    vi.useRealTimers()
    delete (Element.prototype as Partial<Element>).scrollIntoView
    document.body.innerHTML = ''
  })

  const pendingFocusOf = () => renderHook(() => useSettingsSearchKeyboard()).result.current.pendingFocusId

  const renderInScope = () => render(<SettingsFocusScroll scopeRef={{ current: scope }} />)

  it('scrolls to and flashes an immediately present target', () => {
    const target = document.createElement('div')
    target.id = 'setting-general-proxy'
    scope.appendChild(target)

    act(() => {
      setPendingFocus('setting-general-proxy')
    })
    renderInScope()

    expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1)
    expect(target.classList.contains('search-hit-highlight')).toBe(true)
    // Consumed exactly once: the id is cleared so the effect cannot re-fire
    expect(pendingFocusOf()).toBeUndefined()

    act(() => {
      vi.advanceTimersByTime(1600)
    })
    expect(target.classList.contains('search-hit-highlight')).toBe(false)
  })

  it('retries until a late-mounted target appears', () => {
    act(() => {
      setPendingFocus('setting-general-theme')
    })
    renderInScope()

    // First attempt missed; the 80ms retry is pending
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled()
    expect(pendingFocusOf()).toBe('setting-general-theme')

    const target = document.createElement('div')
    target.id = 'setting-general-theme'
    act(() => {
      scope.appendChild(target)
      vi.advanceTimersByTime(80)
    })

    expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1)
    expect(pendingFocusOf()).toBeUndefined()
  })

  it('gives up silently once retries are exhausted', () => {
    act(() => {
      setPendingFocus('setting-general-never-rendered')
    })
    renderInScope()

    act(() => {
      vi.advanceTimersByTime(2000)
    })

    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled()
    // Pending id cleared: no timer keeps running against a dead target
    expect(pendingFocusOf()).toBeUndefined()
  })

  it('ignores a duplicate-id row outside the tab scope (hidden tab)', () => {
    // Another settings tab's DOM survives under <Activity> with the same row
    // id, earlier in document order — a document-level lookup would hit it
    const hiddenTabRow = document.createElement('div')
    hiddenTabRow.id = 'setting-general-proxy'
    document.body.insertBefore(hiddenTabRow, scope)

    const target = document.createElement('div')
    target.id = 'setting-general-proxy'
    scope.appendChild(target)

    act(() => {
      setPendingFocus('setting-general-proxy')
    })
    renderInScope()

    expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1)
    // The in-scope row got the flash; the hidden tab's copy stays untouched
    expect(target.classList.contains('search-hit-highlight')).toBe(true)
    expect(hiddenTabRow.classList.contains('search-hit-highlight')).toBe(false)
  })
})
