// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { Combobox, type ComboboxOption } from '../combobox'
import { Label } from '../label'

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
  }
  Element.prototype.scrollIntoView = vi.fn()
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('Combobox', () => {
  it('can remove and replace a scalar default selection in multiple mode', async () => {
    const onChange = vi.fn()
    render(
      <Combobox
        multiple
        aria-label="Choose targets"
        options={options}
        defaultValue="alpha"
        placeholder="Pick values"
        onChange={onChange}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Remove Alpha' }))
    expect(onChange).toHaveBeenLastCalledWith([])
    expect(screen.queryByRole('button', { name: 'Remove Alpha' })).not.toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Choose targets' })).toHaveTextContent('Pick values')

    fireEvent.click(screen.getByRole('combobox', { name: 'Choose targets' }))
    fireEvent.click(await screen.findByRole('option', { name: 'Beta' }))
    expect(onChange).toHaveBeenLastCalledWith(['beta'])
    expect(screen.getByRole('button', { name: 'Remove Beta' })).toBeInTheDocument()
  })

  it('keeps scalar controlled selections authoritative and submits multiple values as an array', () => {
    const onChange = vi.fn()
    const { container, rerender } = render(
      <Combobox multiple options={options} value="alpha" name="targets" onChange={onChange} />
    )

    expect(container.querySelector('input[name="targets"]')).toHaveValue('["alpha"]')
    fireEvent.click(screen.getByRole('button', { name: 'Remove Alpha' }))
    expect(onChange).toHaveBeenCalledWith([])
    expect(screen.getByRole('button', { name: 'Remove Alpha' })).toBeInTheDocument()

    rerender(<Combobox multiple options={options} value={[]} name="targets" onChange={onChange} />)
    expect(screen.queryByRole('button', { name: 'Remove Alpha' })).not.toBeInTheDocument()
    expect(container.querySelector('input[name="targets"]')).toHaveValue('[]')
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('treats an empty scalar as no multiple selection', () => {
    const { container } = render(
      <Combobox multiple options={options} value="" name="targets" placeholder="Pick values" />
    )

    expect(screen.getByRole('combobox')).toHaveTextContent('Pick values')
    expect(container.querySelector('input[name="targets"]')).toHaveValue('[]')
  })

  it('uses the first array entry in single mode and emits scalar changes', async () => {
    const onChange = vi.fn()
    const { container } = render(
      <Combobox options={options} defaultValue={['beta', 'alpha']} name="target" onChange={onChange} />
    )

    expect(container.querySelector('input[name="target"]')).toHaveValue('beta')
    fireEvent.click(screen.getByRole('button', { name: 'Beta' }))
    fireEvent.click(await screen.findByRole('option', { name: 'Gamma' }))
    expect(onChange).toHaveBeenCalledWith('gamma')
    expect(screen.getByRole('button', { name: 'Gamma' })).toBeInTheDocument()
    expect(container.querySelector('input[name="target"]')).toHaveValue('gamma')
  })

  it('retains selections across mode changes without emitting a user change', () => {
    const onChange = vi.fn()
    const { rerender } = render(
      <Combobox multiple options={options} defaultValue={['alpha', 'beta']} onChange={onChange} />
    )

    rerender(<Combobox options={options} onChange={onChange} />)
    expect(screen.getByRole('button', { name: 'Alpha' })).toBeInTheDocument()

    rerender(<Combobox multiple options={options} onChange={onChange} />)
    expect(screen.getByRole('button', { name: 'Remove Alpha' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove Beta' })).toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('uses external labels as accessible names for every trigger variant', () => {
    render(
      <>
        <Label id="default-combobox-label">Default model</Label>
        <Combobox aria-labelledby="default-combobox-label" options={options} value="beta" />

        <Label id="search-combobox-label">Search model</Label>
        <Combobox aria-labelledby="search-combobox-label" options={options} searchPlacement="trigger" />

        <Label id="multiple-combobox-label">Multiple models</Label>
        <Combobox aria-labelledby="multiple-combobox-label" multiple options={options} />
      </>
    )

    expect(screen.getByRole('button', { name: 'Default model Beta' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Search model' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Multiple models' })).toBeInTheDocument()
  })

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

  it('groups opaque options and searches their labels', async () => {
    render(
      <Combobox
        options={[
          { value: 'assistant:1', label: 'Research helper', group: 'Assistants' },
          { value: 'agent:2', label: 'Code reviewer', group: 'Agents' }
        ]}
        searchPlaceholder="Search targets"
      />
    )

    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByRole('group', { name: 'Assistants' })).toHaveTextContent('Research helper')
    expect(screen.getByRole('group', { name: 'Agents' })).toHaveTextContent('Code reviewer')

    fireEvent.change(screen.getByPlaceholderText('Search targets'), { target: { value: 'research' } })

    await waitFor(() => expect(screen.getByText('Research helper')).toBeInTheDocument())
    expect(screen.queryByText('Code reviewer')).not.toBeInTheDocument()
  })

  it('exposes selected multi-value removal as accessible controls', () => {
    const onChange = vi.fn()

    render(
      <Combobox
        multiple
        options={options}
        value={['alpha', 'beta']}
        placeholder="Pick values"
        emptyText="No results"
        onChange={onChange}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Remove Alpha' }))

    expect(onChange).toHaveBeenCalledWith(['beta'])

    onChange.mockClear()
    fireEvent.keyDown(screen.getByRole('button', { name: 'Remove Alpha' }), { key: 'Enter' })
    expect(onChange).toHaveBeenCalledWith(['beta'])

    onChange.mockClear()
    fireEvent.keyDown(screen.getByRole('button', { name: 'Remove Alpha' }), { key: ' ' })
    expect(onChange).toHaveBeenCalledWith(['beta'])
  })

  it('exposes controlled multi-selection membership on every option', async () => {
    render(
      <Combobox
        multiple
        aria-label="Choose targets"
        options={options}
        value={['alpha', 'beta']}
        placeholder="Pick values"
      />
    )

    fireEvent.click(screen.getByRole('combobox', { name: 'Choose targets' }))

    const listbox = await screen.findByRole('listbox')
    expect(listbox).toHaveAttribute('aria-multiselectable', 'true')
    expect(screen.getByRole('option', { name: 'Alpha' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('option', { name: 'Beta' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('option', { name: 'Gamma' })).toHaveAttribute('aria-checked', 'false')
  })

  it('allows selected multi-value removal labels to be localized', () => {
    render(
      <Combobox
        multiple
        options={options}
        value={['alpha']}
        placeholder="Pick values"
        emptyText="No results"
        getRemoveTagAriaLabel={(label) => `Clear ${label}`}
      />
    )

    expect(screen.getByRole('button', { name: 'Clear Alpha' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Remove Alpha' })).not.toBeInTheDocument()
  })

  it('matches the popover width to a percentage-width trigger', async () => {
    render(<Combobox multiple options={options} width="100%" placeholder="Pick values" />)

    const trigger = screen.getByRole('combobox')
    expect(trigger).toHaveStyle({ width: '100%' })
    fireEvent.click(trigger)

    await waitFor(() => {
      expect(document.querySelector('[data-slot="popover-content"]')).toHaveStyle({
        width: 'var(--radix-popover-trigger-width)'
      })
    })
  })
})
