import { act, render, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import SettingsFocusScroll from '../SettingsFocusScroll'
import { setPendingFocus, useSettingsSearchKeyboard } from '../store'

const { locationMock } = vi.hoisted(() => ({ locationMock: { pathname: '/settings/general' } }))

vi.mock('@tanstack/react-router', () => ({
  useLocation: () => locationMock
}))

describe('SettingsFocusScroll', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    locationMock.pathname = '/settings/general'
    // jsdom has no layout (scrollIntoView is not even defined); the call is the contract
    Element.prototype.scrollIntoView = vi.fn()
    setPendingFocus(undefined)
  })

  afterEach(() => {
    vi.useRealTimers()
    delete (Element.prototype as Partial<Element>).scrollIntoView
    document.body.innerHTML = ''
  })

  const pendingFocusOf = () => renderHook(() => useSettingsSearchKeyboard()).result.current.pendingFocusId

  it('scrolls to and flashes an immediately present target', () => {
    const target = document.createElement('div')
    target.id = 'setting-general-proxy'
    document.body.appendChild(target)

    act(() => {
      setPendingFocus('setting-general-proxy')
    })
    render(<SettingsFocusScroll />)

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
    render(<SettingsFocusScroll />)

    // First attempt missed; the 80ms retry is pending
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled()
    expect(pendingFocusOf()).toBe('setting-general-theme')

    const target = document.createElement('div')
    target.id = 'setting-general-theme'
    act(() => {
      document.body.appendChild(target)
      vi.advanceTimersByTime(80)
    })

    expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1)
    expect(pendingFocusOf()).toBeUndefined()
  })

  it('gives up silently once retries are exhausted', () => {
    act(() => {
      setPendingFocus('setting-general-never-rendered')
    })
    render(<SettingsFocusScroll />)

    act(() => {
      vi.advanceTimersByTime(2000)
    })

    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled()
    // Pending id cleared: no timer keeps running against a dead target
    expect(pendingFocusOf()).toBeUndefined()
  })
})
