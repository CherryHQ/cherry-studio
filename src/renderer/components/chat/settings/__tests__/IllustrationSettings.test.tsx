import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'

import { preferenceService } from '@data/PreferenceService'
import i18n from '@renderer/i18n/resolver'

import { IllustrationSettings } from '../IllustrationSettings'

vi.mock('@cherrystudio/ui', async () => vi.importActual('@cherrystudio/ui'))
vi.unmock('@data/hooks/usePreference')
vi.unmock('@data/PreferenceService')
vi.mock('@renderer/hooks/useModel', () => ({
  useDefaultModel: () => ({ paintingModel: undefined, setPaintingModel: vi.fn() })
}))
vi.mock('@renderer/hooks/useProvider', () => ({ useProviders: () => ({ providers: [] }) }))
vi.mock('@renderer/components/DefaultModelSelector', () => ({ DefaultModelSelector: () => null }))

const stored = new Map<string, unknown>()
const preferenceIpc = {
  get: vi.fn(async (key: string) => stored.get(key)),
  set: vi.fn(async (key: string, value: unknown) => {
    stored.set(key, value)
  }),
  subscribe: vi.fn(async () => {}),
  unsubscribe: vi.fn(async () => {})
}

beforeEach(async () => {
  stored.set('chat.illustration.mode', 'off')
  stored.set('chat.illustration.max_count', 1)
  stored.set('chat.illustration.target_count', 1)
  Object.assign(window.api, { preference: preferenceIpc })
  preferenceService.clearCache()
  HTMLElement.prototype.hasPointerCapture = () => false
  HTMLElement.prototype.releasePointerCapture = () => {}
  HTMLElement.prototype.setPointerCapture = () => {}
  HTMLElement.prototype.scrollIntoView = () => {}
  await i18n.changeLanguage('en-US')
})

// Catches selecting a visible mode without persisting it, or showing model configuration while off.
it('persists all three modes through the actual select control and preserves the value on remount', async () => {
  const user = userEvent.setup()
  const view = render(<IllustrationSettings />)
  expect(screen.getByRole('combobox', { name: 'Reply illustrations' })).toHaveTextContent('Off')
  expect(screen.queryByText('Painting Model')).not.toBeInTheDocument()
  for (const [label, value] of [
    ['Automatic', 'auto'],
    ['Forced', 'on'],
    ['Off', 'off'],
    ['Forced', 'on']
  ]) {
    await user.click(screen.getByRole('combobox', { name: 'Reply illustrations' }))
    await user.click(await screen.findByRole('option', { name: label }))
    await waitFor(() => expect(stored.get('chat.illustration.mode')).toBe(value))
    expect(screen.getByRole('combobox', { name: 'Reply illustrations' })).toHaveTextContent(label)
    if (value === 'off') {
      expect(screen.queryByText('Painting Model')).not.toBeInTheDocument()
      expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument()
    } else expect(screen.getByText('Painting Model')).toBeInTheDocument()
  }
  view.unmount()
  preferenceService.clearCache()
  render(<IllustrationSettings />)
  await waitFor(() => expect(screen.getByRole('combobox', { name: 'Reply illustrations' })).toHaveTextContent('Forced'))
})

// Catches exposing both quantities or clamping the forced target to the automatic maximum.
it('shows the active quantity and remembers the maximum and target independently across mode changes and remounts', async () => {
  const user = userEvent.setup()
  stored.set('chat.illustration.mode', 'auto')
  const view = render(<IllustrationSettings />)

  const maxCount = await screen.findByRole('spinbutton', { name: 'Maximum count' })
  expect(maxCount).toHaveValue('1')
  expect(screen.queryByRole('switch')).not.toBeInTheDocument()
  expect(screen.queryByRole('spinbutton', { name: 'Target count' })).not.toBeInTheDocument()
  await user.clear(maxCount)
  await user.type(maxCount, '3')
  await user.keyboard('{Enter}')
  await waitFor(() => expect(stored.get('chat.illustration.max_count')).toBe(3))

  await user.click(screen.getByRole('combobox', { name: 'Reply illustrations' }))
  await user.click(await screen.findByRole('option', { name: 'Forced' }))
  expect(screen.queryByRole('spinbutton', { name: 'Maximum count' })).not.toBeInTheDocument()

  const targetCount = screen.getByRole('spinbutton', { name: 'Target count' })
  await user.clear(targetCount)
  await user.type(targetCount, '6')
  await user.keyboard('{Enter}')
  await waitFor(() => expect(stored.get('chat.illustration.target_count')).toBe(6))

  await user.click(screen.getByRole('combobox', { name: 'Reply illustrations' }))
  await user.click(await screen.findByRole('option', { name: 'Automatic' }))
  const restoredMaximum = screen.getByRole('spinbutton', { name: 'Maximum count' })
  expect(restoredMaximum).toHaveValue('3')
  await user.clear(restoredMaximum)
  await user.type(restoredMaximum, '2')
  await user.keyboard('{Enter}')
  await waitFor(() => {
    expect(stored.get('chat.illustration.max_count')).toBe(2)
    expect(stored.get('chat.illustration.target_count')).toBe(6)
  })

  await user.click(screen.getByRole('combobox', { name: 'Reply illustrations' }))
  await user.click(await screen.findByRole('option', { name: 'Forced' }))
  expect(screen.getByRole('spinbutton', { name: 'Target count' })).toHaveValue('6')
  view.unmount()
  preferenceService.clearCache()
  render(<IllustrationSettings />)
  await waitFor(() => expect(screen.getByRole('spinbutton', { name: 'Target count' })).toHaveValue('6'))
})
