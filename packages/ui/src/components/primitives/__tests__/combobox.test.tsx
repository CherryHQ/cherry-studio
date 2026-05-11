// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { Combobox, type ComboboxOption } from '../combobox'

const options: ComboboxOption[] = [
  { value: 'alpha', label: 'Alpha' },
  { value: 'beta', label: 'Beta' },
  { value: 'gamma', label: 'Gamma' }
]

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as any
  Element.prototype.scrollIntoView = vi.fn()
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('Combobox', () => {
  it('maps the selected value to the trigger placeholder when opened', async () => {
    render(
      <Combobox
        options={options}
        value="beta"
        searchPlacement="trigger"
        placeholder="Pick one"
        emptyText="No results"
      />
    )

    const input = screen.getByRole<HTMLInputElement>('combobox')
    expect(input).toHaveValue('Beta')

    fireEvent.click(input)

    await waitFor(() => {
      expect(input).toHaveFocus()
      expect(input).toHaveValue('')
      expect(input).toHaveAttribute('placeholder', 'Beta')
    })
    expect(screen.getByText('Alpha')).toBeInTheDocument()
    expect(screen.getByText('Beta')).toBeInTheDocument()
    expect(screen.getByText('Gamma')).toBeInTheDocument()
  })

  it('filters options from the trigger input when searchPlacement is trigger', () => {
    render(<Combobox options={options} searchPlacement="trigger" placeholder="Pick one" emptyText="No results" />)

    const input = screen.getByRole('combobox')
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'gam' } })

    expect(screen.getByText('Gamma')).toBeInTheDocument()
    expect(screen.queryByText('Alpha')).not.toBeInTheDocument()
    expect(screen.queryByText('Beta')).not.toBeInTheDocument()
  })

  it('selects the first filtered option with Enter in trigger search mode', () => {
    const onChange = vi.fn()
    render(
      <Combobox
        options={options}
        searchPlacement="trigger"
        placeholder="Pick one"
        emptyText="No results"
        onChange={onChange}
      />
    )

    const input = screen.getByRole('combobox')
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'bet' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(onChange).toHaveBeenCalledWith('beta')
  })

  it('keeps trigger search open when the trigger input is clicked while open', async () => {
    render(<Combobox options={options} searchPlacement="trigger" placeholder="Pick one" emptyText="No results" />)

    const input = screen.getByRole('combobox')
    fireEvent.click(input)

    await waitFor(() => {
      expect(screen.getByText('Alpha')).toBeInTheDocument()
    })

    fireEvent.click(input)

    expect(screen.getByText('Alpha')).toBeInTheDocument()
    expect(input).toHaveAttribute('aria-expanded', 'true')
  })

  it('does not clear a single value when the selected option is selected again', () => {
    const onChange = vi.fn()
    render(
      <Combobox
        options={options}
        value="beta"
        searchPlacement="trigger"
        placeholder="Pick one"
        emptyText="No results"
        onChange={onChange}
      />
    )

    const input = screen.getByRole('combobox')
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'bet' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(onChange).not.toHaveBeenCalled()
    expect(onChange).not.toHaveBeenCalledWith('')
  })

  it('applies filterOption in content search mode', async () => {
    render(
      <Combobox
        options={options.map((option) => ({
          ...option,
          description: option.value === 'gamma' ? 'Third item' : 'Regular item'
        }))}
        placeholder="Pick one"
        searchPlaceholder="Search descriptions"
        emptyText="No results"
        filterOption={(option, search) => option.description?.toLowerCase().includes(search.toLowerCase()) ?? false}
      />
    )

    fireEvent.click(screen.getByRole('button'))
    fireEvent.change(screen.getByPlaceholderText('Search descriptions'), { target: { value: 'third' } })

    await waitFor(() => {
      expect(screen.getByText('Gamma')).toBeInTheDocument()
    })
    expect(screen.queryByText('Alpha')).not.toBeInTheDocument()
    expect(screen.queryByText('Beta')).not.toBeInTheDocument()
  })
})
