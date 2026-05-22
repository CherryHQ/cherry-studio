import { Checkbox, Input, Label } from '@cherrystudio/ui'
import type { Meta, StoryObj } from '@storybook/react'

const meta: Meta<typeof Label> = {
  title: 'Components/Primitives/Label',
  component: Label,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'Accessible label for form controls. Forwards to Radix `Label.Root` so clicks focus the associated control.'
      }
    }
  },
  tags: ['autodocs']
}

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: () => (
    <div className="flex w-72 flex-col gap-2">
      <Label htmlFor="email">Email</Label>
      <Input id="email" type="email" placeholder="hello@cherry.studio" />
    </div>
  )
}

export const WithCheckbox: Story = {
  render: () => (
    <div className="flex items-center gap-2">
      <Checkbox id="terms" />
      <Label htmlFor="terms">Accept terms and conditions</Label>
    </div>
  )
}

export const Required: Story = {
  render: () => (
    <div className="flex w-72 flex-col gap-2">
      <Label htmlFor="name">
        Name <span className="text-destructive">*</span>
      </Label>
      <Input id="name" placeholder="Required field" />
    </div>
  )
}

export const DisabledPeer: Story = {
  render: () => (
    <div className="flex w-72 flex-col gap-2">
      <Label htmlFor="disabled-input">Disabled input</Label>
      <Input id="disabled-input" className="peer" disabled placeholder="disabled" />
      <Label htmlFor="disabled-input" className="peer-disabled:opacity-50">
        Label dims with the disabled peer
      </Label>
    </div>
  )
}
