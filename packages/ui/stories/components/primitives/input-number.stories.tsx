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
          'A thin `Input` wrapper for numeric entry. Filtering follows the declared constraints: `min` decides whether a minus sign is allowed, `step` decides whether a decimal point is. Clamping happens on blur, never mid-edit.'
      }
    }
  }
}

export default meta
type Story = StoryObj<typeof meta>

export const Integer: Story = {
  render: function IntegerExample() {
    const [value, setValue] = useState<number | null>(10)
    return (
      <div className="flex items-center gap-3">
        <InputNumber className="w-40" min={1} max={99} step={1} value={value} onChange={setValue} />
        <span className="text-muted-foreground text-sm">Value: {value ?? 'null'}</span>
      </div>
    )
  }
}

export const Decimal: Story = {
  render: function DecimalExample() {
    const [value, setValue] = useState<number | null>(1.5)
    return (
      <div className="flex items-center gap-3">
        <InputNumber className="w-40" min={0} step={0.1} value={value} onChange={setValue} />
        <span className="text-muted-foreground text-sm">Value: {value ?? 'null'}</span>
      </div>
    )
  }
}

export const Signed: Story = {
  render: function SignedExample() {
    const [value, setValue] = useState<number | null>(-0.5)
    return (
      <div className="flex items-center gap-3">
        <InputNumber className="w-40" step={0.1} value={value} onChange={setValue} />
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
        <InputGroupInputNumber min={0} step={5} value={value} onChange={setValue} />
        <InputGroupAddon align="inline-end">
          <InputGroupText>minutes</InputGroupText>
        </InputGroupAddon>
      </InputGroup>
    )
  }
}
