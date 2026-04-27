import { EditableNumber } from '@cherrystudio/ui'
import type { Meta, StoryObj } from '@storybook/react'
import { useState } from 'react'

const meta: Meta<typeof EditableNumber> = {
  title: 'Components/Composites/EditableNumber',
  component: EditableNumber,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'A numeric input that shows a formatted display until focused, then reveals the real `<input type="number">` for editing. Supports precision, min/max, prefix/suffix, and optional commit-on-blur semantics.'
      }
    }
  },
  tags: ['autodocs'],
  argTypes: {
    size: { control: { type: 'radio' }, options: ['small', 'middle', 'large'] },
    align: { control: { type: 'radio' }, options: ['start', 'center', 'end'] },
    disabled: { control: 'boolean' },
    changeOnBlur: { control: 'boolean' }
  }
}

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: function DefaultExample() {
    const [value, setValue] = useState<number | null>(3.14)
    return (
      <div className="flex items-center gap-3">
        <EditableNumber value={value} onChange={setValue} precision={2} className="w-40" />
        <span className="text-sm text-muted-foreground">Value: {value ?? 'null'}</span>
      </div>
    )
  }
}

export const Sizes: Story = {
  render: function SizesExample() {
    const [value, setValue] = useState<number | null>(42)
    return (
      <div className="flex flex-col gap-3">
        <EditableNumber value={value} onChange={setValue} size="small" className="w-40" />
        <EditableNumber value={value} onChange={setValue} size="middle" className="w-40" />
        <EditableNumber value={value} onChange={setValue} size="large" className="w-40" />
      </div>
    )
  }
}

export const WithMinMax: Story = {
  render: function MinMaxExample() {
    const [value, setValue] = useState<number | null>(50)
    return (
      <div className="flex items-center gap-3">
        <EditableNumber value={value} onChange={setValue} min={0} max={100} step={1} className="w-40" />
        <span className="text-sm text-muted-foreground">Clamped 0–100</span>
      </div>
    )
  }
}

export const WithAffixes: Story = {
  render: function AffixExample() {
    const [temperature, setTemperature] = useState<number | null>(0.7)
    const [price, setPrice] = useState<number | null>(19.99)
    return (
      <div className="flex flex-col gap-3">
        <EditableNumber
          value={temperature}
          onChange={setTemperature}
          precision={2}
          min={0}
          max={2}
          step={0.05}
          suffix=" temp"
          className="w-40"
        />
        <EditableNumber value={price} onChange={setPrice} precision={2} prefix="$ " className="w-40" />
      </div>
    )
  }
}

export const ChangeOnBlur: Story = {
  render: function ChangeOnBlurExample() {
    const [commits, setCommits] = useState<(number | null)[]>([])
    const [value, setValue] = useState<number | null>(10)
    return (
      <div className="flex w-60 flex-col gap-3">
        <EditableNumber
          value={value}
          onChange={(next) => {
            setValue(next)
            setCommits((prev) => [...prev, next])
          }}
          changeOnBlur
          precision={0}
          className="w-40"
        />
        <p className="text-xs text-muted-foreground">
          Commits only fire on blur/Enter. Values: {commits.map((v) => v ?? 'null').join(', ') || '—'}
        </p>
      </div>
    )
  }
}

export const Disabled: Story = {
  render: () => <EditableNumber value={42} disabled className="w-40" />
}
