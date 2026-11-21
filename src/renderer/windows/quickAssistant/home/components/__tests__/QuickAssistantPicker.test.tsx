import '@testing-library/jest-dom/vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'

import en from '@renderer/i18n/locales/en-us.json'
import type { Assistant } from '@shared/data/types/assistant'

import QuickAssistantPicker from '../QuickAssistantPicker'

// Regression targets: real popover search/keyboard selection must reach the save
// boundary; failed saves stay visible/retryable; a missing catalog must not block
// returning to model mode. Do not freeze menu order or icon styling.
vi.mock('@cherrystudio/ui', async (original) => original())
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => en[key as keyof typeof en] ?? key }) }))
const catalog = vi.hoisted(() => ({
  assistants: [] as Assistant[],
  hasLoaded: true,
  error: null as Error | null,
  refetch: vi.fn()
}))
vi.mock('@renderer/hooks/useAssistant', () => ({ useAssistantsApi: () => catalog }))
const writer = { id: 'writer', name: 'Writer', avatarSrc: 'https://example.com/writer.png' } as Assistant
const coder = { id: 'coder', name: 'Code helper' } as Assistant

beforeEach(() => {
  catalog.assistants = [writer, coder]
  catalog.hasLoaded = true
  catalog.error = null
  catalog.refetch.mockClear()
  Element.prototype.scrollIntoView = vi.fn()
})

it('filters the real command list and selects an assistant with the keyboard', async () => {
  const user = userEvent.setup()
  const save = vi.fn().mockResolvedValue(undefined)
  render(<QuickAssistantPicker assistant={writer} modelName="Quick model" onSelect={save} />)
  await user.click(screen.getByRole('button', { name: en['settings.models.quick_assistant_selection'] }))
  await user.type(screen.getByRole('combobox'), 'code')
  expect(screen.queryByRole('option', { name: 'Writer' })).not.toBeInTheDocument()
  await user.keyboard('{ArrowDown}{Enter}')
  await waitFor(() => expect(save).toHaveBeenCalledWith('coder'))
  await waitFor(() => expect(screen.queryByRole('combobox')).not.toBeInTheDocument())
  await user.click(screen.getByRole('button', { name: en['settings.models.quick_assistant_selection'] }))
  expect(screen.getByRole('combobox')).toHaveValue('')
  expect(screen.getByRole('option', { name: 'Writer' })).toBeInTheDocument()
})

it('keeps failed saves retryable without selecting another item during an outstanding save', async () => {
  const user = userEvent.setup()
  let reject!: (error: Error) => void
  const save = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<void>((_resolve, fail) => {
          reject = fail
        })
    )
    .mockResolvedValue(undefined)
  render(<QuickAssistantPicker assistant={writer} onSelect={save} />)
  await user.click(screen.getByRole('button', { name: en['settings.models.quick_assistant_selection'] }))
  await user.click(screen.getByRole('option', { name: 'Code helper' }))
  expect(screen.getByRole('combobox')).toBeDisabled()
  await act(async () => reject(new Error('offline')))
  expect(screen.getByRole('alert')).toHaveTextContent(en['common.save_failed'])
  await user.click(screen.getByRole('option', { name: 'Code helper' }))
  await waitFor(() => expect(save).toHaveBeenCalledTimes(2))
  await waitFor(() => expect(screen.queryByRole('combobox')).not.toBeInTheDocument())
})

it('allows returning to model mode with an empty assistant catalog', async () => {
  const user = userEvent.setup()
  catalog.assistants = []
  const save = vi.fn().mockResolvedValue(undefined)
  render(<QuickAssistantPicker assistant={writer} modelName="Quick model" onSelect={save} />)
  await user.click(screen.getByRole('button', { name: en['settings.models.quick_assistant_selection'] }))
  await user.click(screen.getByRole('option', { name: `${en['settings.models.use_model']}: Quick model` }))
  expect(save).toHaveBeenCalledWith('')
})

it('shows a catalog failure and retries loading rather than presenting an empty success', async () => {
  const user = userEvent.setup()
  catalog.error = new Error('offline')
  render(<QuickAssistantPicker assistant={writer} onSelect={vi.fn()} />)
  await user.click(screen.getByRole('button', { name: en['settings.models.quick_assistant_selection'] }))
  expect(screen.getByRole('alert')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: en['common.retry'] }))
  expect(catalog.refetch).toHaveBeenCalled()
})
