// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { InputGroup, InputGroupInputNumber } from '../input-group'
import { InputNumber, type InputNumberProps } from '../input-number'

function Controlled({ initial = null, ...props }: Partial<InputNumberProps> & { initial?: number | null }) {
  const [value, setValue] = useState<number | null>(initial)
  return <InputNumber aria-label="amount" value={value} onValueChange={setValue} {...props} />
}

describe('InputNumber', () => {
  it('settles a typed negative at min instead of dropping the sign', async () => {
    const user = userEvent.setup()
    const onBlur = vi.fn()
    render(<Controlled min={0} onBlur={onBlur} />)

    await user.type(screen.getByLabelText('amount'), '-5')
    expect(screen.getByLabelText('amount')).toHaveValue('-5')

    await user.tab()
    expect(onBlur).toHaveBeenCalledExactlyOnceWith(0)
  })

  it('settles a typed and a pasted negative on the same value', async () => {
    const user = userEvent.setup()
    const typed = vi.fn()
    const pasted = vi.fn()
    render(
      <>
        <Controlled min={1} onBlur={typed} />
        <InputNumber aria-label="pasted" min={1} value={null} onBlur={pasted} />
      </>
    )

    await user.type(screen.getByLabelText('amount'), '-3')
    await user.tab()

    await user.click(screen.getByLabelText('pasted'))
    await user.paste('-3')
    await user.tab()

    expect(typed).toHaveBeenCalledExactlyOnceWith(1)
    expect(pasted).toHaveBeenCalledExactlyOnceWith(1)
  })

  it('keeps a minus sign when no min is given', async () => {
    const user = userEvent.setup()
    render(<Controlled step={0.1} />)

    await user.type(screen.getByLabelText('amount'), '-0.5')

    expect(screen.getByLabelText('amount')).toHaveValue('-0.5')
  })

  it('truncates the fraction when committing if step is an integer', async () => {
    const user = userEvent.setup()
    const onBlur = vi.fn()
    render(<InputNumber aria-label="amount" min={0} step={1} value={null} onBlur={onBlur} />)

    await user.type(screen.getByLabelText('amount'), '3.9')
    // The fraction stays visible while typing — truncating per keystroke would
    // glue "9" onto "3" and produce 39.
    expect(screen.getByLabelText('amount')).toHaveValue('3.9')

    await user.tab()
    expect(onBlur).toHaveBeenCalledExactlyOnceWith(3)
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

  it('clamps to the range when committing', async () => {
    const user = userEvent.setup()
    const onBlur = vi.fn()
    render(<InputNumber aria-label="amount" min={10} max={99} value={null} onBlur={onBlur} />)

    await user.type(screen.getByLabelText('amount'), '5')
    await user.tab()

    expect(onBlur).toHaveBeenCalledExactlyOnceWith(10)
  })

  it('reports null for an emptied field', async () => {
    const user = userEvent.setup()
    const onValueChange = vi.fn()
    render(<InputNumber aria-label="amount" min={0} value={42} onValueChange={onValueChange} />)

    await user.clear(screen.getByLabelText('amount'))

    expect(onValueChange).toHaveBeenLastCalledWith(null)
  })

  it('reports each value as it forms, and settles once', async () => {
    const user = userEvent.setup()
    const onValueChange = vi.fn()
    const onBlur = vi.fn()
    render(<InputNumber aria-label="amount" min={0} value={null} onValueChange={onValueChange} onBlur={onBlur} />)

    await user.type(screen.getByLabelText('amount'), '42')
    expect(onValueChange.mock.calls).toEqual([[4], [42]])
    expect(onBlur).not.toHaveBeenCalled()

    await user.tab()
    expect(onBlur).toHaveBeenCalledExactlyOnceWith(42)
  })

  it('reports the raw value to onValueChange and the normalized one to onBlur', async () => {
    const user = userEvent.setup()
    const onValueChange = vi.fn()
    const onBlur = vi.fn()
    render(
      <InputNumber
        aria-label="amount"
        min={10}
        max={99}
        step={1}
        value={null}
        onValueChange={onValueChange}
        onBlur={onBlur}
      />
    )

    await user.type(screen.getByLabelText('amount'), '5')
    // Not clamped yet: doing so mid-edit would make "50" unreachable.
    expect(onValueChange).toHaveBeenLastCalledWith(5)

    await user.tab()
    expect(onBlur).toHaveBeenCalledExactlyOnceWith(10)
  })

  it('follows an external value change while unfocused', () => {
    const { rerender } = render(<InputNumber aria-label="amount" value={1} onValueChange={vi.fn()} />)
    expect(screen.getByLabelText('amount')).toHaveValue('1')

    rerender(<InputNumber aria-label="amount" value={7} onValueChange={vi.fn()} />)

    expect(screen.getByLabelText('amount')).toHaveValue('7')
  })

  it('does not overwrite what is being typed when the value changes externally', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<InputNumber aria-label="amount" min={0} value={1} onValueChange={vi.fn()} />)

    const input = screen.getByLabelText('amount')
    await user.clear(input)
    await user.type(input, '12')

    rerender(<InputNumber aria-label="amount" min={0} value={99} onValueChange={vi.fn()} />)

    expect(input).toHaveValue('12')
  })

  it('renders no spinner and keeps the Input invalid styling', () => {
    render(<InputNumber aria-label="amount" aria-invalid value={1} onValueChange={vi.fn()} />)

    const input = screen.getByLabelText('amount')
    expect(input).toHaveAttribute('type', 'text')
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input.className).toContain('aria-invalid:border-destructive')
  })

  it('keeps exponent notation instead of splicing its digits together', async () => {
    const user = userEvent.setup()
    const onBlur = vi.fn()
    render(<InputNumber aria-label="amount" value={null} onBlur={onBlur} />)

    await user.type(screen.getByLabelText('amount'), '1e-6')
    await user.tab()

    expect(onBlur).toHaveBeenCalledExactlyOnceWith(1e-6)
  })

  it('rejects a pasted value it cannot parse rather than filtering it', async () => {
    const user = userEvent.setup()
    const onValueChange = vi.fn()
    render(<InputNumber aria-label="amount" value={12} onValueChange={onValueChange} />)

    const input = screen.getByLabelText('amount')
    await user.click(input)
    await user.paste('3 000')

    expect(input).toHaveValue('12')
    expect(onValueChange).not.toHaveBeenCalled()
  })

  it('discards the edit on Escape and commits the restored value', async () => {
    const user = userEvent.setup()
    const onBlur = vi.fn()
    render(<InputNumber aria-label="amount" value={7} onBlur={onBlur} />)

    const input = screen.getByLabelText('amount')
    await user.click(input)
    await user.type(input, '89')
    expect(input).toHaveValue('789')

    await user.keyboard('{Escape}')
    expect(input).toHaveValue('7')

    await user.tab()
    expect(onBlur).toHaveBeenCalledExactlyOnceWith(7)
  })

  it('warns and settles on min when the range is empty', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const user = userEvent.setup()
    const onBlur = vi.fn()
    render(<InputNumber aria-label="amount" min={10} max={5} value={null} onBlur={onBlur} />)

    await user.type(screen.getByLabelText('amount'), '7')
    await user.tab()

    expect(onBlur).toHaveBeenCalledExactlyOnceWith(10)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('min (10) is greater than max (5)'))
    warn.mockRestore()
  })

  it('takes the group control slot so InputGroup can style and focus it', () => {
    render(
      <InputGroup>
        <InputGroupInputNumber aria-label="amount" value={30} onValueChange={vi.fn()} />
      </InputGroup>
    )

    const input = screen.getByLabelText('amount')
    expect(input).toHaveAttribute('data-slot', 'input-group-control')
    expect(input.className).toContain('border-0')
  })

  it('reports null only for an emptied field, not for a prefix that is not a value yet', async () => {
    const user = userEvent.setup()
    const onValueChange = vi.fn()
    render(<InputNumber aria-label="amount" value={null} onValueChange={onValueChange} />)

    const input = screen.getByLabelText('amount')
    await user.type(input, '1e-6')
    expect(onValueChange.mock.calls.map(([value]) => value)).toEqual([1, 1e-6])

    await user.clear(input)
    expect(onValueChange).toHaveBeenLastCalledWith(null)
  })

  it('steps by step in the step own precision', async () => {
    const user = userEvent.setup()
    render(<Controlled initial={0.2} step={0.1} />)

    const input = screen.getByLabelText('amount')
    await user.click(input)
    await user.keyboard('{ArrowUp}')
    expect(input).toHaveValue('0.3')

    await user.keyboard('{ArrowDown}{ArrowDown}')
    expect(input).toHaveValue('0.1')
  })

  it('stops stepping at the bounds instead of walking past them', async () => {
    const user = userEvent.setup()
    render(<Controlled initial={9.9} min={0} max={10} step={0.1} />)

    const input = screen.getByLabelText('amount')
    await user.click(input)
    await user.keyboard('{ArrowUp}{ArrowUp}{ArrowUp}')
    expect(input).toHaveValue('10')

    await user.clear(input)
    await user.type(input, '0.1')
    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}')
    expect(input).toHaveValue('0')
  })

  it('steps an empty field up from min rather than from zero', async () => {
    const user = userEvent.setup()
    render(<Controlled min={5} max={20} step={1} />)

    const input = screen.getByLabelText('amount')
    await user.click(input)
    await user.keyboard('{ArrowUp}')

    expect(input).toHaveValue('6')
  })

  it('reports a step like a keystroke and settles it only when focus leaves', async () => {
    const user = userEvent.setup()
    const onValueChange = vi.fn()
    const onBlur = vi.fn()
    render(<InputNumber aria-label="amount" value={3} step={2} onValueChange={onValueChange} onBlur={onBlur} />)

    const input = screen.getByLabelText('amount')
    await user.click(input)
    await user.keyboard('{ArrowUp}')
    expect(onValueChange).toHaveBeenLastCalledWith(5)
    expect(onBlur).not.toHaveBeenCalled()

    await user.tab()
    expect(onBlur).toHaveBeenCalledExactlyOnceWith(5)
  })

  it('exposes its range and current value to assistive tech', async () => {
    const user = userEvent.setup()
    render(<Controlled initial={4} min={0} max={20} step={1} />)

    const input = screen.getByRole('spinbutton', { name: 'amount' })
    expect(input).toHaveAttribute('aria-valuemin', '0')
    expect(input).toHaveAttribute('aria-valuemax', '20')
    expect(input).toHaveAttribute('aria-valuenow', '4')

    await user.clear(input)
    expect(input).not.toHaveAttribute('aria-valuenow')

    await user.type(input, '7')
    expect(input).toHaveAttribute('aria-valuenow', '7')
  })

  it('omits the bounds it was not given', () => {
    render(<InputNumber aria-label="amount" value={1} onValueChange={vi.fn()} />)

    const input = screen.getByRole('spinbutton', { name: 'amount' })
    expect(input).not.toHaveAttribute('aria-valuemin')
    expect(input).not.toHaveAttribute('aria-valuemax')
  })

  it('lets className override the default height', () => {
    render(<InputNumber aria-label="amount" className="h-8 rounded-lg" value={1} onValueChange={vi.fn()} />)

    expect(screen.getByLabelText('amount').className).toContain('h-8')
  })
})
