import { Button, ButtonGroup } from '@cherrystudio/ui'
import type { Meta, StoryObj } from '@storybook/react'
import { ChevronLeft, ChevronRight, LayoutGrid, List } from 'lucide-react'

const meta: Meta<typeof ButtonGroup> = {
  title: 'Components/Primitives/ButtonGroup',
  component: ButtonGroup,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'Groups multiple Button components into a single horizontal or vertical control. Supports attached and separated layouts.'
      }
    }
  },
  tags: ['autodocs'],
  argTypes: {
    orientation: {
      control: { type: 'select' },
      options: ['horizontal', 'vertical']
    },
    attached: {
      control: { type: 'boolean' }
    }
  }
}

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: () => (
    <ButtonGroup>
      <Button variant="outline">Day</Button>
      <Button variant="outline">Week</Button>
      <Button variant="outline">Month</Button>
    </ButtonGroup>
  )
}

export const Vertical: Story = {
  render: () => (
    <ButtonGroup orientation="vertical">
      <Button variant="outline">Overview</Button>
      <Button variant="outline">Activity</Button>
      <Button variant="outline">Settings</Button>
    </ButtonGroup>
  )
}

export const Separated: Story = {
  render: () => (
    <ButtonGroup attached={false}>
      <Button variant="outline">
        <ChevronLeft />
        Previous
      </Button>
      <Button variant="outline">
        Next
        <ChevronRight />
      </Button>
    </ButtonGroup>
  )
}

export const IconToggleStyle: Story = {
  render: () => (
    <ButtonGroup>
      <Button variant="outline" size="icon" aria-label="Grid view">
        <LayoutGrid />
      </Button>
      <Button variant="outline" size="icon" aria-label="List view">
        <List />
      </Button>
    </ButtonGroup>
  )
}
