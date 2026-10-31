import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  iconNames: ['heart', 'heart-pulse', 'alarm-clock', 'house'],
  translations: {
    'common.search': 'Search',
    'common.no_results': 'No results',
    'selection.settings.user_modal.icon.label': 'Icon',
    'selection.settings.user_modal.icon.placeholder': 'Icon name',
    'selection.settings.user_modal.icon.random': 'Random icon'
  } as Record<string, string>,
  useVirtualizer: vi.fn(({ count, estimateSize }: { count: number; estimateSize: () => number }) => ({
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({
        index,
        key: index,
        start: index * estimateSize()
      })),
    getTotalSize: () => count * 40,
    measureElement: vi.fn()
  }))
}))

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: mocks.useVirtualizer
}))

vi.mock('@cherrystudio/ui', async (importOriginal) => importOriginal())

vi.mock('lucide-react/dynamic', () => ({
  DynamicIcon: ({ name }: { name: string }) => <svg data-testid={`icon-${name}`} />,
  iconNames: mocks.iconNames
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => mocks.translations[key] ?? key })
}))

import SelectionActionIconPicker from '../SelectionActionIconPicker'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('SelectionActionIconPicker', () => {
  it('filters available icons by name and closes after selecting one', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<SelectionActionIconPicker value="heart" onChange={onChange} />)

    await user.click(screen.getByText('heart'))
    const search = screen.getByRole('textbox', { name: 'Search' })
    await user.type(search, 'pulse')

    expect(screen.getByRole('button', { name: 'heart-pulse' })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'heart' })).toHaveLength(1)

    await user.click(screen.getByRole('button', { name: 'heart-pulse' }))

    expect(onChange).toHaveBeenCalledWith('heart-pulse')
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Search' })).not.toBeInTheDocument())
  })

  it('keeps the random icon shortcut limited to available icons', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    render(<SelectionActionIconPicker value="" onChange={onChange} />)

    await user.click(screen.getByRole('button', { name: 'Random icon' }))

    expect(onChange).toHaveBeenCalledWith('alarm-clock')
  })

  it('does not offer unsupported icon values saved before the picker', async () => {
    const user = userEvent.setup()
    render(<SelectionActionIconPicker value="missing-icon" onChange={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'missing-icon' }))
    await user.type(screen.getByRole('textbox', { name: 'Search' }), 'missing-icon')

    expect(screen.getByText('No results')).toBeInTheDocument()
  })
})
