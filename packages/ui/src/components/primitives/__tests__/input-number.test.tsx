// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useRef, useState } from 'react'
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

  it('keeps a minus sign while the text is being typed', async () => {
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

  it('restores the pre-edit value instead of turning an incomplete number into null', async () => {
    const user = userEvent.setup()
    const onBlur = vi.fn()

    function Controlled() {
      const [value, setValue] = useState<number | null>(42)
      return (
        <InputNumber
          aria-label="amount"
          value={value}
          onValueChange={setValue}
          onBlur={(settled) => {
            onBlur(settled)
            setValue(settled)
          }}
        />
      )
    }

    render(<Controlled />)
    const input = screen.getByLabelText('amount')
    await user.clear(input)
    await user.type(input, '1e')
    await user.tab()

    expect(onBlur).toHaveBeenCalledExactlyOnceWith(42)
    expect(input).toHaveValue('42')
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

  // Escape leaves the field, so the commit it triggers must settle on what the
  // edit started from — the text on screen is still the discarded one.
  it('discards the edit on Escape, leaves the field, and commits the restored value', async () => {
    const user = userEvent.setup()
    const onBlur = vi.fn()
    render(<InputNumber aria-label="amount" value={7} onBlur={onBlur} />)

    const input = screen.getByLabelText('amount')
    await user.click(input)
    await user.type(input, '89')
    expect(input).toHaveValue('789')

    await user.keyboard('{Escape}')

    expect(input).toHaveValue('7')
    expect(input).not.toHaveFocus()
    expect(onBlur).toHaveBeenCalledExactlyOnceWith(7)
  })

  it('restores the value the edit started from for callers that write on every change', async () => {
    const user = userEvent.setup()
    const onValueChange = vi.fn()

    function LiveCoupled() {
      const [value, setValue] = useState<number | null>(7)
      return (
        <InputNumber
          aria-label="amount"
          value={value}
          onValueChange={(next) => {
            onValueChange(next)
            setValue(next)
          }}
        />
      )
    }
    render(<LiveCoupled />)

    const input = screen.getByLabelText('amount')
    await user.click(input)
    await user.type(input, '89')
    expect(input).toHaveValue('789')

    await user.keyboard('{Escape}')
    expect(input).toHaveValue('7')
    expect(onValueChange).toHaveBeenLastCalledWith(7)
  })

  it('keeps Escape from reaching window, which would exit fullscreen', async () => {
    const user = userEvent.setup()
    const onWindowKeyDown = vi.fn()
    window.addEventListener('keydown', onWindowKeyDown)
    render(<InputNumber aria-label="amount" value={7} />)

    await user.click(screen.getByLabelText('amount'))
    await user.keyboard('{Escape}')
    window.removeEventListener('keydown', onWindowKeyDown)

    expect(onWindowKeyDown.mock.calls.map(([event]) => event.key)).not.toContain('Escape')
  })

  // No number is both >= 10 and <= 5, so there is nothing for either bound to
  // win: below, inside and above the inverted range all settle on nothing.
  it.each(['3', '7', '20'])('settles on no value at all when the range is empty (%s)', async (typed) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const user = userEvent.setup()
    const onBlur = vi.fn()
    render(<InputNumber aria-label="amount" min={10} max={5} value={null} onBlur={onBlur} />)

    const input = screen.getByLabelText('amount')
    await user.type(input, typed)
    await user.tab()

    expect(onBlur).toHaveBeenCalledExactlyOnceWith(null)
    expect(input).toHaveValue('')
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('min (10) is greater than max (5)'))
    warn.mockRestore()
  })

  // Every row measured against a real `input[type=number]`: the grid is anchored at
  // `min`, and an off-grid value moves to the next grid point in the direction of
  // travel rather than carrying its remainder along.
  it.each([
    ['3.7', 1, undefined, undefined, '4', '3'],
    ['3.7', 1, 1, undefined, '4', '3'],
    ['4', 1, 1, undefined, '5', '3'],
    ['3.7', 1, 0.5, undefined, '4.5', '3.5'],
    ['0.25', 0.1, undefined, undefined, '0.3', '0.2'],
    ['3.7', 0.5, undefined, undefined, '4', '3.5']
  ])('steps %s by %s onto the grid (min=%s)', async (typed, step, min, max, expectedUp, expectedDown) => {
    const user = userEvent.setup()

    for (const [key, expected] of [
      ['{ArrowUp}', expectedUp],
      ['{ArrowDown}', expectedDown]
    ] as const) {
      const view = render(<InputNumber aria-label="amount" min={min} max={max} step={step} value={null} />)
      const input = screen.getByLabelText('amount')
      await user.type(input, typed)
      await user.keyboard(key)

      expect(input).toHaveValue(expected)
      view.unmount()
    }
  })

  // An empty field has no base, and a base outside the range must not be dragged
  // backwards by the clamp: an arrow may not move the value against its direction.
  it.each([
    ['from empty, Up lands on min', '', 1, 5, undefined, '{ArrowUp}', '5'],
    ['from empty, Down lands on max', '', 1, 1, 10, '{ArrowDown}', '10'],
    ['from empty with no bound, Up steps from zero', '', 1, undefined, undefined, '{ArrowUp}', '1'],
    ['Down below min does not raise the value', '0', 1, 5, undefined, '{ArrowDown}', '0'],
    ['Up above max does not lower the value', '100', 1, 1, 10, '{ArrowUp}', '100'],
    ['Down above max still enters the range', '100', 1, 1, 10, '{ArrowDown}', '10'],
    ['from empty with no bound that way, Down offers nothing', '', 1, 5, undefined, '{ArrowDown}', '']
  ])('%s', async (_name, typed, step, min, max, key, expected) => {
    const user = userEvent.setup()
    render(<InputNumber aria-label="amount" min={min} max={max} step={step} value={null} />)

    const input = screen.getByLabelText('amount')
    await user.click(input)
    if (typed) await user.type(input, typed)
    await user.keyboard(key)

    expect(input).toHaveValue(expected)
  })

  // Emptying a field that has a saved value is the same empty field as one that
  // never had one: there is no base on screen to step from.
  it('lands on the bound when a field cleared of its saved value is stepped', async () => {
    const user = userEvent.setup()
    render(<InputNumber aria-label="amount" min={5} step={1} value={1024} />)

    const input = screen.getByLabelText('amount')
    await user.clear(input)
    await user.keyboard('{ArrowUp}')

    expect(input).toHaveValue('5')
  })

  // `String` turns anything below 1e-6 into exponential form, which would hand
  // back `1e-7` to someone who typed the decimal out.
  it('settles a small decimal without rewriting it into exponential form', async () => {
    const user = userEvent.setup()

    function Controlled() {
      const [value, setValue] = useState<number | null>(0.5)
      return <InputNumber aria-label="amount" min={0} max={1} step={0.05} value={value} onBlur={setValue} />
    }
    render(<Controlled />)

    const input = screen.getByLabelText('amount')
    await user.clear(input)
    await user.type(input, '0.0000001')
    await user.tab()

    expect(input).toHaveValue('0.0000001')
  })

  // The grid arithmetic rounds to the step's decimals, and reading an exponential
  // step as zero of them would round every result back to a whole number.
  it('steps by a step too small to render without an exponent', async () => {
    const user = userEvent.setup()
    render(<InputNumber aria-label="amount" min={0} step={1e-7} value={0} />)

    const input = screen.getByLabelText('amount')
    await user.click(input)
    await user.keyboard('{ArrowUp}')

    expect(input).toHaveValue('0.0000001')
  })

  // A caller whose `value` only catches up after a round trip would otherwise render
  // the old value between blur and that round trip finishing.
  it('holds the settled value while an async commit is in flight', async () => {
    const user = userEvent.setup()
    let finish: () => void = () => {}
    const onBlur = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)))
    // `value` deliberately never moves: it stands in for a caller still fetching.
    render(<InputNumber aria-label="amount" min={0} step={1} value={0} onBlur={onBlur} />)

    const input = screen.getByLabelText('amount')
    await user.click(input)
    await user.clear(input)
    await user.type(input, '30')
    await user.tab()

    expect(input).toHaveValue('30')
    expect(input).toHaveAttribute('aria-busy', 'true')

    await act(async () => finish())

    expect(input).toHaveValue('0')
    expect(input).not.toHaveAttribute('aria-busy')
  })

  it('falls back to the saved value when an async commit fails', async () => {
    const user = userEvent.setup()
    let fail: (reason: unknown) => void = () => {}
    const onBlur = vi.fn(() => new Promise<void>((_resolve, reject) => (fail = reject)))
    render(<InputNumber aria-label="amount" min={0} step={1} value={0} onBlur={onBlur} />)

    const input = screen.getByLabelText('amount')
    await user.click(input)
    await user.clear(input)
    await user.type(input, '30')
    await user.tab()

    await act(async () => fail(new Error('save failed')))

    expect(input).toHaveValue('0')
    expect(input).not.toHaveAttribute('aria-busy')
  })

  it('keeps the committed value when it arrives before the commit settles', async () => {
    const user = userEvent.setup()
    const onBlur = vi.fn(() => new Promise<void>(() => {}))
    const { rerender } = render(<InputNumber aria-label="amount" min={0} step={1} value={0} onBlur={onBlur} />)

    const input = screen.getByLabelText('amount')
    await user.click(input)
    await user.clear(input)
    await user.type(input, '30')
    await user.tab()
    rerender(<InputNumber aria-label="amount" min={0} step={1} value={30} onBlur={onBlur} />)

    expect(input).toHaveValue('30')
  })

  it('keeps showing the committed value when the field is re-entered mid-commit', async () => {
    const user = userEvent.setup()
    const onBlur = vi.fn(() => new Promise<void>(() => {}))
    render(<InputNumber aria-label="amount" min={0} step={1} value={0} onBlur={onBlur} />)

    const input = screen.getByLabelText('amount')
    await user.click(input)
    await user.clear(input)
    await user.type(input, '30')
    await user.tab()
    await user.click(input)

    // `value` is still 0 — one round trip behind — so seeding the edit from it
    // would put the flash we just removed back on the way in.
    expect(input).toHaveValue('30')

    await user.type(input, '5')
    await user.keyboard('{Escape}')
    expect(input).toHaveValue('30')
  })

  it('lets a re-focused field keep what is being typed when the commit settles', async () => {
    const user = userEvent.setup()
    let finish: () => void = () => {}
    const onBlur = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)))
    render(<InputNumber aria-label="amount" min={0} step={1} value={0} onBlur={onBlur} />)

    const input = screen.getByLabelText('amount')
    await user.click(input)
    await user.type(input, '30')
    await user.tab()

    await user.click(input)
    await user.clear(input)
    await user.type(input, '7')
    await act(async () => finish())

    expect(input).toHaveValue('7')
    expect(input).not.toHaveAttribute('aria-busy')
  })

  it('refuses to step when the range is empty', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const user = userEvent.setup()
    const onValueChange = vi.fn()
    render(<InputNumber aria-label="amount" min={10} max={5} value={7} onValueChange={onValueChange} />)

    const input = screen.getByLabelText('amount')
    await user.click(input)
    await user.keyboard('{ArrowUp}')

    expect(input).toHaveValue('7')
    expect(onValueChange).not.toHaveBeenCalled()
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

  it('reports a step like a keystroke and settles it only when focus leaves', async () => {
    const user = userEvent.setup()
    const onValueChange = vi.fn()
    const onBlur = vi.fn()
    // On-grid start, so this stays about when the callbacks fire; the grid itself
    // is covered by the stepping table above.
    render(<InputNumber aria-label="amount" value={4} step={2} onValueChange={onValueChange} onBlur={onBlur} />)

    const input = screen.getByLabelText('amount')
    await user.click(input)
    await user.keyboard('{ArrowUp}')
    expect(onValueChange).toHaveBeenLastCalledWith(6)
    expect(onBlur).not.toHaveBeenCalled()

    await user.tab()
    expect(onBlur).toHaveBeenCalledExactlyOnceWith(6)
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

  // Nothing here declares a ref: React 19 passes it as an ordinary prop, so it
  // survives only as long as no wrapper in the chain filters what it spreads.
  it('forwards a ref through to the underlying input', () => {
    function WithRef() {
      const ref = useRef<HTMLInputElement>(null)
      return (
        <>
          <InputNumber ref={ref} aria-label="amount" value={1} onValueChange={vi.fn()} />
          <button type="button" onClick={() => ref.current?.focus()}>
            focus
          </button>
        </>
      )
    }
    render(<WithRef />)

    screen.getByRole('button', { name: 'focus' }).click()

    expect(screen.getByLabelText('amount')).toHaveFocus()
  })

  it('lets className override the default height', () => {
    render(<InputNumber aria-label="amount" className="h-8 rounded-lg" value={1} onValueChange={vi.fn()} />)

    expect(screen.getByLabelText('amount').className).toContain('h-8')
  })
})
