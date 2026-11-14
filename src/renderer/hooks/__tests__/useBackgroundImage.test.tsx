import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { useBackgroundImageInjection } from '../useBackgroundImage'

const ELEMENT_ID = 'user-defined-background-image'
const options = { image: 'https://example.com/a.png', opacity: 40, blur: 5, size: 'cover' as const }

describe('useBackgroundImageInjection', () => {
  afterEach(() => {
    document.getElementById(ELEMENT_ID)?.remove()
    document.documentElement.removeAttribute('data-custom-background')
  })

  it('renders the background layer and removes it when the image is cleared or unmounted', () => {
    const { rerender, unmount } = renderHook((props) => useBackgroundImageInjection(props), { initialProps: options })

    const element = document.getElementById(ELEMENT_ID)
    expect(element?.style.opacity).toBe('0.4')
    expect(element?.style.backgroundImage).toContain('https://example.com/a.png')
    expect(document.documentElement.hasAttribute('data-custom-background')).toBe(true)

    rerender({ ...options, image: '' })
    expect(document.getElementById(ELEMENT_ID)).toBeNull()
    expect(document.documentElement.hasAttribute('data-custom-background')).toBe(false)

    rerender(options)
    unmount()
    expect(document.getElementById(ELEMENT_ID)).toBeNull()
  })

  it('ignores unsupported URL schemes', () => {
    renderHook(() => useBackgroundImageInjection({ ...options, image: 'javascript:alert(1)' }))
    expect(document.getElementById(ELEMENT_ID)).toBeNull()
  })
})
