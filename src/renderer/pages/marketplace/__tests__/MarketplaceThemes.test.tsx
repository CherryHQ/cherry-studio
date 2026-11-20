import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import i18next from 'i18next'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { useCustomCss } from '@renderer/hooks/useCustomCss'
import type { MarketplaceTheme } from '@shared/ipc/schemas/theme'

import { extractMarketplaceThemeColors } from '../marketplaceThemeColors'
import { MarketplaceThemes } from '../MarketplaceThemes'

vi.mock('@cherrystudio/ui', async (original) => original())

// jsdom implements insertRule but not the constructable stylesheet's replaceSync.
beforeEach(() => {
  Object.defineProperty(CSSStyleSheet.prototype, 'replaceSync', {
    configurable: true,
    value(this: CSSStyleSheet, source: string) {
      this.insertRule(source)
    }
  })
})
afterEach(() => {
  Reflect.deleteProperty(CSSStyleSheet.prototype, 'replaceSync')
  cleanup()
  vi.useRealTimers()
})

it('restarts the ten-second window on a second preview and restores the original CSS', async () => {
  await i18next.changeLanguage('en-us')
  vi.useFakeTimers()
  const original = 'body { color: navy }'
  MockUsePreferenceUtils.setPreferenceValue('ui.custom_css', original)
  const items: MarketplaceTheme[] = ['red', 'green'].map((color) => ({
    id: color,
    name: color,
    code: `body { color: ${color}; display: block }`,
    author: '',
    title: [],
    description: '',
    version: '1',
    cdn_link: '',
    light_mode: true,
    dark_mode: false,
    light_pic: '',
    dark_pic: ''
  }))
  function Window() {
    useCustomCss()
    return (
      <MarketplaceThemes
        preview
        catalog={{
          data: [{ items, total: 2 }],
          isLoading: false,
          isValidating: false,
          error: undefined,
          size: 1,
          setSize: vi.fn(),
          mutate: vi.fn()
        }}
      />
    )
  }
  render(<Window />)
  const preview = (name: string) => {
    fireEvent.click(screen.getByRole('button', { name: new RegExp(name) }))
    fireEvent.click(screen.getByRole('button', { name: /preview/i }))
  }
  const css = () => document.querySelector('#user-defined-custom-css')?.textContent
  preview('red')
  act(() => {
    vi.advanceTimersByTime(6000)
  })
  preview('green')
  act(() => {
    vi.advanceTimersByTime(9999)
  })
  expect(css()).toBe('body { color: green; }')
  act(() => {
    vi.advanceTimersByTime(1)
  })
  expect(css()).toBe(original)
  preview('green')
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  expect(MockUsePreferenceUtils.getPreferenceValue('ui.custom_css')).toBe('body { color: green; }')
})

it('builds color rules only for known theme scopes and discards indirect values and at-rules', () => {
  expect(
    extractMarketplaceThemeColors(
      ':root { --primary: #123456; --accent: var(--brand); background-image: url(texture.png) }'
    )
  ).toBe(':root { --primary: #123456; }')
  expect(extractMarketplaceThemeColors('.custom-card { color: red }')).toBe('')
  expect(extractMarketplaceThemeColors('@media print { body { color: blue } }')).toBe('')
})
