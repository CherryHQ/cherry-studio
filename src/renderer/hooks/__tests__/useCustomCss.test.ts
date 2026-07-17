import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import { useCustomCss, useCustomCssInjection } from '../useCustomCss'

const STYLE_ID = 'user-defined-custom-css'
const styleEl = () => document.getElementById(STYLE_ID)

const THEME_CSS = ':root { --primary: red; --background: white; }'

describe('useCustomCss', () => {
  beforeEach(() => {
    MockUsePreferenceUtils.resetMocks()
    styleEl()?.remove()
  })

  it('injects the adapted community-theme bridge for a shadcn paste (acceptance #5)', () => {
    MockUsePreferenceUtils.setPreferenceValue('ui.custom_css', THEME_CSS)

    renderHook(() => useCustomCss())

    const el = styleEl()
    expect(el).not.toBeNull()
    expect(el!.textContent).toContain('shadcn community theme bridge')
    expect(el!.textContent).toContain('--color-primary: var(--primary);')
  })

  it('passes ordinary custom CSS through unchanged', () => {
    const css = 'body { color: red; }'
    MockUsePreferenceUtils.setPreferenceValue('ui.custom_css', css)

    renderHook(() => useCustomCss())

    expect(styleEl()!.textContent).toBe(css)
  })
})

describe('useCustomCssInjection', () => {
  beforeEach(() => {
    styleEl()?.remove()
  })

  it('injects the given CSS verbatim — no community adaptation (acceptance #5)', () => {
    // The selection toolbar path: a theme-shaped input must NOT gain a bridge here.
    renderHook(() => useCustomCssInjection(THEME_CSS))

    expect(styleEl()!.textContent).toBe(THEME_CSS)
  })

  it('removes the style element on unmount', () => {
    const { unmount } = renderHook(() => useCustomCssInjection('body { color: red; }'))
    expect(styleEl()).not.toBeNull()

    unmount()

    expect(styleEl()).toBeNull()
  })

  it('removes the element when the CSS becomes empty', () => {
    const { rerender } = renderHook(({ css }) => useCustomCssInjection(css), {
      initialProps: { css: 'body { color: red; }' as string | undefined }
    })
    expect(styleEl()).not.toBeNull()

    rerender({ css: undefined })

    expect(styleEl()).toBeNull()
  })
})
