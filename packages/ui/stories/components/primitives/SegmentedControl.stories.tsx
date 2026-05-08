import { SegmentedControl } from '@cherrystudio/ui'
import type { Meta, StoryObj } from '@storybook/react'
import { Code, FileText, LayoutGrid, List, Monitor, Moon, Sun } from 'lucide-react'
import { useState } from 'react'

const meta: Meta<typeof SegmentedControl> = {
  title: 'Components/Primitives/SegmentedControl',
  component: SegmentedControl,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'A pill-shaped segmented control for choosing exactly one option from a compact set. Useful for settings rows, view modes, and short enum choices.'
      }
    }
  },
  tags: ['autodocs'],
  argTypes: {
    value: {
      control: { type: 'text' },
      description: 'The selected option value in controlled mode'
    },
    defaultValue: {
      control: { type: 'text' },
      description: 'The initially selected option value in uncontrolled mode'
    },
    disabled: {
      control: { type: 'boolean' },
      description: 'Whether the whole control is disabled'
    },
    size: {
      control: { type: 'select' },
      options: ['sm', 'default'],
      description: 'The visual size of each segment'
    }
  }
}

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: {
    defaultValue: 'system',
    options: [
      { value: 'light', label: 'Light' },
      { value: 'dark', label: 'Dark' },
      { value: 'system', label: 'System' }
    ]
  }
}

export const Sizes: Story = {
  render: () => (
    <div className="flex flex-col gap-5">
      <div>
        <p className="mb-2 text-sm text-muted-foreground">Small</p>
        <SegmentedControl
          size="sm"
          defaultValue="left"
          options={[
            { value: 'left', label: 'Left' },
            { value: 'right', label: 'Right' }
          ]}
        />
      </div>
      <div>
        <p className="mb-2 text-sm text-muted-foreground">Default</p>
        <SegmentedControl
          defaultValue="grid"
          options={[
            { value: 'grid', label: 'Grid' },
            { value: 'list', label: 'List' },
            { value: 'compact', label: 'Compact' }
          ]}
        />
      </div>
    </div>
  )
}

export const WithIcons: Story = {
  render: () => (
    <SegmentedControl
      defaultValue="system"
      options={[
        {
          value: 'light',
          label: (
            <>
              <Sun className="size-4" />
              Light
            </>
          )
        },
        {
          value: 'dark',
          label: (
            <>
              <Moon className="size-4" />
              Dark
            </>
          )
        },
        {
          value: 'system',
          label: (
            <>
              <Monitor className="size-4" />
              System
            </>
          )
        }
      ]}
    />
  )
}

export const Disabled: Story = {
  render: () => (
    <div className="flex flex-col gap-5">
      <div>
        <p className="mb-2 text-sm text-muted-foreground">Entire control disabled</p>
        <SegmentedControl
          disabled
          defaultValue="grid"
          options={[
            { value: 'grid', label: 'Grid' },
            { value: 'list', label: 'List' }
          ]}
        />
      </div>
      <div>
        <p className="mb-2 text-sm text-muted-foreground">One option disabled</p>
        <SegmentedControl
          defaultValue="read"
          options={[
            { value: 'read', label: 'Read' },
            { value: 'write', label: 'Write', disabled: true },
            { value: 'admin', label: 'Admin' }
          ]}
        />
      </div>
    </div>
  )
}

export const ViewMode: Story = {
  render: () => (
    <SegmentedControl
      size="sm"
      defaultValue="grid"
      aria-label="View mode"
      options={[
        {
          value: 'grid',
          label: (
            <>
              <LayoutGrid className="size-4" />
              Grid
            </>
          )
        },
        {
          value: 'list',
          label: (
            <>
              <List className="size-4" />
              List
            </>
          )
        },
        {
          value: 'details',
          label: (
            <>
              <FileText className="size-4" />
              Details
            </>
          )
        }
      ]}
    />
  )
}

export const Controlled: Story = {
  render: function ControlledExample() {
    const [value, setValue] = useState('preview')

    return (
      <div className="flex flex-col items-center gap-3">
        <SegmentedControl
          value={value}
          onValueChange={setValue}
          options={[
            { value: 'preview', label: 'Preview' },
            { value: 'code', label: 'Code' },
            { value: 'split', label: 'Split' }
          ]}
        />
        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <Code className="size-4" />
          Selected: {value}
        </div>
      </div>
    )
  }
}
