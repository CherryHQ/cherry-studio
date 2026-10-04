import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.unmock('@cherrystudio/ui')

const translationMock = vi.hoisted(() => ({
  t: (key: string) => key
}))

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: vi.fn() },
  useTranslation: () => translationMock
}))

import { TaskTimeSelect } from '../TasksSettings'

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  Element.prototype.scrollIntoView = vi.fn()
})

beforeEach(() => {
  translationMock.t = (key: string) => key
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('TaskTimeSelect with the production Combobox', () => {
  it('keeps a compact summary and preserves the minute when an hour is deselected', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const selectedHours = Array.from({ length: 16 }, (_, hour) => String(hour).padStart(2, '0'))

    render(<TaskTimeSelect value={selectedHours.map((hour) => `${hour}:30`).join(',')} onChange={onChange} />)

    const timeSelect = screen.getByRole('group', { name: 'agent.tasks.schedule.time' })
    const hourSelect = within(timeSelect).getByRole('combobox', { name: 'agent.tasks.schedule.hours' })
    const summary = within(hourSelect).getByText(selectedHours.join(', '))

    // Truncation is the layout contract that prevents selected values from escaping the fixed-height trigger.
    expect(summary).toHaveClass('min-w-0', 'flex-1', 'truncate', 'text-left')

    await user.click(hourSelect)
    const listbox = await screen.findByRole('listbox')
    const selectedOption = within(listbox).getByRole('option', { name: '05' })
    expect(selectedOption).toHaveAttribute('aria-checked', 'true')
    expect(within(listbox).getByRole('option', { name: '20' })).toHaveAttribute('aria-checked', 'false')

    await user.click(selectedOption)
    expect(onChange).toHaveBeenLastCalledWith(
      selectedHours
        .filter((hour) => hour !== '05')
        .map((hour) => `${hour}:30`)
        .join(',')
    )
  })

  it('shows the localized hours placeholder when no hour is selected', () => {
    translationMock.t = (key: string) => (key === 'agent.tasks.schedule.hours' ? 'Hours' : key)

    render(<TaskTimeSelect value="" onChange={vi.fn()} />)

    const hourSelect = screen.getByRole('combobox', { name: 'Hours' })
    expect(within(hourSelect).getByText('Hours')).toHaveClass('text-muted-foreground')
  })
})
