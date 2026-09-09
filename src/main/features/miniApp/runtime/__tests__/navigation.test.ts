import { describe, expect, it, vi } from 'vitest'

import { installNavigationPolicy, shouldAllowNavigation } from '../navigation'

const APP = 'com.example.mygame'

describe('shouldAllowNavigation', () => {
  it('allows navigation inside the app origin', () => {
    expect(shouldAllowNavigation(`cherry-miniapp://${APP}/page2.html`, APP)).toBe(true)
  })

  it('blocks navigation to the open web', () => {
    expect(shouldAllowNavigation('https://evil.com', APP)).toBe(false)
  })

  it('blocks navigation to another app origin', () => {
    expect(shouldAllowNavigation('cherry-miniapp://com.example.other/index.html', APP)).toBe(false)
  })

  it('blocks file and javascript urls', () => {
    expect(shouldAllowNavigation('file:///etc/passwd', APP)).toBe(false)
    expect(shouldAllowNavigation('javascript:alert(1)', APP)).toBe(false)
  })
})

describe('installNavigationPolicy', () => {
  function fakeContents() {
    const handlers = new Map<string, (...args: unknown[]) => void>()
    return {
      on: vi.fn((evt: string, fn: (...args: unknown[]) => void) => handlers.set(evt, fn)),
      setWindowOpenHandler: vi.fn(),
      handlers
    }
  }

  it('vetoes a will-navigate leaving the app origin', () => {
    const contents = fakeContents()
    installNavigationPolicy(contents as never, APP)
    const event = { preventDefault: vi.fn() }

    contents.handlers.get('will-navigate')?.(event, 'https://evil.com')

    expect(event.preventDefault).toHaveBeenCalled()
  })

  it('leaves an in-origin will-navigate alone', () => {
    const contents = fakeContents()
    installNavigationPolicy(contents as never, APP)
    const event = { preventDefault: vi.fn() }

    contents.handlers.get('will-navigate')?.(event, `cherry-miniapp://${APP}/page2.html`)

    expect(event.preventDefault).not.toHaveBeenCalled()
  })

  it('denies every window.open', () => {
    const contents = fakeContents()
    installNavigationPolicy(contents as never, APP)

    const handler = contents.setWindowOpenHandler.mock.calls[0][0] as (d: { url: string }) => { action: string }
    expect(handler({ url: 'https://example.com' })).toEqual({ action: 'deny' })
  })
})
