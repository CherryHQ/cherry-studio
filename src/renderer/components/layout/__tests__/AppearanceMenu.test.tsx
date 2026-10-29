import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ThemeContext } from '@renderer/hooks/useTheme'
import i18n from '@renderer/i18n/resolver'
import { ThemeMode } from '@shared/data/preference/preferenceTypes'

import { AppearanceMenu } from '../AppearanceMenu'

vi.unmock('@cherrystudio/ui')

function ThemeMenu() {
  const [theme, setTheme] = useState(ThemeMode.dark)
  return (
    <ThemeContext value={{ theme, settedTheme: theme, setTheme, toggleTheme: () => {} }}>
      <AppearanceMenu />
    </ThemeContext>
  )
}

beforeEach(async () => {
  await i18n.changeLanguage('zh-CN')
})

describe('AppearanceMenu', () => {
  it('shows the current mode, opens on hover, and applies the selected mode before closing', async () => {
    const user = userEvent.setup()
    render(<ThemeMenu />)
    const trigger = screen.getByRole('button', { name: '外观' })
    expect(trigger).toHaveTextContent('深色')

    await user.hover(trigger)
    expect(await screen.findByRole('button', { name: '深色', pressed: true })).toBeVisible()
    await user.click(screen.getByRole('button', { name: '浅色', pressed: false }))

    await waitFor(() => expect(screen.queryByRole('group', { name: '外观' })).not.toBeInTheDocument())
    expect(trigger).toHaveTextContent('浅色')
    await user.click(trigger)
    expect(await screen.findByRole('button', { name: '浅色', pressed: true })).toBeVisible()
    expect(screen.getByRole('button', { name: '深色', pressed: false })).toBeVisible()
  })

  it('supports opening the selected mode and choosing system mode with the keyboard', async () => {
    const user = userEvent.setup()
    render(<ThemeMenu />)
    const trigger = screen.getByRole('button', { name: '外观' })
    trigger.focus()

    await user.keyboard('{ArrowRight}')
    expect(await screen.findByRole('button', { name: '深色', pressed: true })).toHaveFocus()
    await user.keyboard('{Tab}{Enter}')

    await waitFor(() => expect(screen.queryByRole('group', { name: '外观' })).not.toBeInTheDocument())
    expect(trigger).toHaveTextContent('系统')
    expect(trigger).toHaveFocus()
  })

  it('dismisses with Escape without changing the current theme', async () => {
    const user = userEvent.setup()
    render(<ThemeMenu />)
    const trigger = screen.getByRole('button', { name: '外观' })
    trigger.focus()

    await user.keyboard('{Enter}')
    await screen.findByRole('button', { name: '深色', pressed: true })
    await user.keyboard('{Escape}')

    await waitFor(() => expect(trigger).toHaveFocus())
    expect(trigger).toHaveTextContent('深色')
    expect(screen.queryByRole('group', { name: '外观' })).not.toBeInTheDocument()
  })
})
