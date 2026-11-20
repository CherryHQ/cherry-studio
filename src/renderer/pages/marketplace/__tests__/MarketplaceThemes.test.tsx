import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import i18next from 'i18next'
import { afterEach, expect, it, vi } from 'vitest'

import { useCustomCss } from '@renderer/hooks/useCustomCss'
import type { MarketplaceTheme } from '@shared/ipc/schemas/theme'

import { MarketplaceThemes } from '../MarketplaceThemes'

vi.mock('@cherrystudio/ui', async (original) => original())

afterEach(() => {
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
    code: `body { color: ${color} }`,
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
  expect(css()).toBe(items[1].code)
  act(() => {
    vi.advanceTimersByTime(1)
  })
  expect(css()).toBe(original)
})
