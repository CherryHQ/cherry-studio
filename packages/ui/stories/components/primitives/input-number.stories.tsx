import { InputGroup, InputGroupAddon, InputGroupInputNumber, InputGroupText, InputNumber } from '@cherrystudio/ui'
import type { Meta, StoryObj } from '@storybook/react'
import { useState } from 'react'

const meta: Meta<typeof InputNumber> = {
  title: 'Components/Primitives/input-number',
  component: InputNumber,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'A thin `Input` wrapper for numeric entry. Keystrokes are filtered only on whether the text could still become a number, so a minus sign is always typable; `min`/`max`/`step` are settled on commit, never mid-edit. Settling is what `onBlur` reports, so a field wired to `onValueChange` alone never normalizes — every story below routes `onBlur` back into `value`.'
      }
    }
  }
}

export default meta
type Story = StoryObj<typeof meta>

/** The shape most call sites want: the field owns the text being typed, and only the settled value is written. */
export const Integer: Story = {
  render: function IntegerExample() {
    const [value, setValue] = useState<number | null>(10)
    return (
      <div className="flex items-center gap-3">
        <InputNumber className="w-40" min={1} max={99} step={1} value={value} onBlur={setValue} />
        <span className="text-muted-foreground text-sm">Value: {value ?? 'null'}</span>
      </div>
    )
  }
}

/** A fractional `step` keeps the decimals: `3.99` settles as typed, arrows move by `0.1`, and `min` raises anything below `0`. */
export const Decimal: Story = {
  render: function DecimalExample() {
    const [value, setValue] = useState<number | null>(1.5)
    return (
      <div className="flex items-center gap-3">
        <InputNumber className="w-40" min={0} step={0.1} value={value} onBlur={setValue} />
        <span className="text-muted-foreground text-sm">Value: {value ?? 'null'}</span>
      </div>
    )
  }
}

/**
 * Live coupling: `onValueChange` fires as soon as the text is a number, for a value that
 * has to drive something else while it is typed. It is un-normalized, so `onBlur` still
 * has to be wired or nothing ever settles.
 */
export const Signed: Story = {
  render: function SignedExample() {
    const [value, setValue] = useState<number | null>(-0.5)
    return (
      <div className="flex items-center gap-3">
        <InputNumber className="w-40" step={0.1} value={value} onValueChange={setValue} onBlur={setValue} />
        <span className="text-muted-foreground text-sm">Value: {value ?? 'null'}</span>
      </div>
    )
  }
}

export const InGroup: Story = {
  render: function InGroupExample() {
    const [value, setValue] = useState<number | null>(30)
    return (
      <InputGroup className="w-40">
        <InputGroupInputNumber min={0} step={5} value={value} onBlur={setValue} />
        <InputGroupAddon align="inline-end">
          <InputGroupText>minutes</InputGroupText>
        </InputGroupAddon>
      </InputGroup>
    )
  }
}
