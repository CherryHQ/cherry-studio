// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { InputNumber, type InputNumberProps } from '../input-number'

function Controlled({ initial = null, ...props }: Partial<InputNumberProps> & { initial?: number | null }) {
  const [value, setValue] = useState<number | null>(initial)
  return <InputNumber aria-label="amount" value={value} onChange={setValue} {...props} />
}

describe('InputNumber', () => {
  it('drops a minus sign when min forbids negatives', async () => {
    const user = userEvent.setup()
    render(<Controlled min={0} />)

    await user.type(screen.getByLabelText('amount'), '-5')

    expect(screen.getByLabelText('amount')).toHaveValue('5')
  })

  it('keeps a minus sign when no min is given', async () => {
    const user = userEvent.setup()
    render(<Controlled step={0.1} />)

    await user.type(screen.getByLabelText('amount'), '-0.5')

    expect(screen.getByLabelText('amount')).toHaveValue('-0.5')
  })

  it('truncates the fraction on blur when step is an integer', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<InputNumber aria-label="amount" min={0} step={1} value={null} onChange={onChange} />)

    await user.type(screen.getByLabelText('amount'), '3.9')
    // The fraction stays visible while typing — truncating per keystroke would
    // glue "9" onto "3" and produce 39.
    expect(screen.getByLabelText('amount')).toHaveValue('3.9')

    await user.tab()
    expect(onChange).toHaveBeenLastCalledWith(3)
  })

  it('keeps only the first decimal point when step allows decimals', async () => {
    const user = userEvent.setup()
    render(<Controlled min={0} step={0.1} />)

    await user.type(screen.getByLabelText('amount'), '1.2.5')

    expect(screen.getByLabelText('amount')).toHaveValue('1.25')
  })

  it('does not clamp while typing', async () => {
    const user = userEvent.setup()
    render(<Controlled min={10} max={99} />)

    await user.type(screen.getByLabelText('amount'), '5')

    expect(screen.getByLabelText('amount')).toHaveValue('5')
  })

  it('clamps to the range on blur', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<InputNumber aria-label="amount" min={10} max={99} value={null} onChange={onChange} />)

    await user.type(screen.getByLabelText('amount'), '5')
    await user.tab()

    expect(onChange).toHaveBeenLastCalledWith(10)
  })

  it('reports null for an emptied field', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<InputNumber aria-label="amount" min={0} value={42} onChange={onChange} />)

    await user.clear(screen.getByLabelText('amount'))

    expect(onChange).toHaveBeenLastCalledWith(null)
  })

  it('does not report a value mid-edit when changeOnBlur is set', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<InputNumber aria-label="amount" min={0} changeOnBlur value={null} onChange={onChange} />)

    await user.type(screen.getByLabelText('amount'), '42')
    expect(onChange).not.toHaveBeenCalled()

    await user.tab()
    expect(onChange).toHaveBeenCalledExactlyOnceWith(42)
  })

  it('follows an external value change while unfocused', () => {
    const { rerender } = render(<InputNumber aria-label="amount" value={1} onChange={vi.fn()} />)
    expect(screen.getByLabelText('amount')).toHaveValue('1')

    rerender(<InputNumber aria-label="amount" value={7} onChange={vi.fn()} />)

    expect(screen.getByLabelText('amount')).toHaveValue('7')
  })

  it('does not overwrite what is being typed when the value changes externally', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<InputNumber aria-label="amount" min={0} value={1} onChange={vi.fn()} />)

    const input = screen.getByLabelText('amount')
    await user.clear(input)
    await user.type(input, '12')

    rerender(<InputNumber aria-label="amount" min={0} value={99} onChange={vi.fn()} />)

    expect(input).toHaveValue('12')
  })

  it('renders no spinner and keeps the Input invalid styling', () => {
    render(<InputNumber aria-label="amount" aria-invalid value={1} onChange={vi.fn()} />)

    const input = screen.getByLabelText('amount')
    expect(input).toHaveAttribute('type', 'text')
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input.className).toContain('aria-invalid:border-destructive')
  })

  it('lets className override the default height', () => {
    render(<InputNumber aria-label="amount" className="h-8 rounded-lg" value={1} onChange={vi.fn()} />)

    expect(screen.getByLabelText('amount').className).toContain('h-8')
  })
})
