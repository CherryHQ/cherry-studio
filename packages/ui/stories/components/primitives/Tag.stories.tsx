import type { Meta, StoryObj } from '@storybook/react-vite'
import { AlertTriangleIcon, StarIcon } from 'lucide-react'
import { action } from 'storybook/actions'

import { Tag } from '../../../src/components'

const meta: Meta<typeof Tag> = {
  title: 'Components/Primitives/Tag',
  component: Tag,
  parameters: {
    layout: 'centered'
  },
  tags: ['autodocs'],
  argTypes: {
    color: { control: 'color' },
    size: {
      control: { type: 'select' },
      options: ['sm', 'md', 'lg']
    },
    disabled: { control: 'boolean' },
    inactive: { control: 'boolean' },
    closable: { control: 'boolean' },
    onClose: { action: 'closed' },
    onClick: { action: 'clicked' }
  }
}

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: {
    children: 'Tag',
    color: '#3cd45a'
  }
}

export const WithIcon: Story = {
  args: {
    children: 'With Icon',
    color: '#52c41a',
    icon: <StarIcon size={14} />
  }
}

export const Closable: Story = {
  args: {
    children: 'Rachel Meyers',
    color: '#3cd45a',
    closable: true,
    onClose: action('tag-closed')
  }
}

export const Sizes: Story = {
  render: () => (
    <div className="flex flex-col gap-6">
      <div>
        <h4 className="mb-2 text-sm text-gray-500">Text type</h4>
        <div className="flex items-center gap-4">
          <Tag color="#3cd45a" size="lg">
            3
          </Tag>
          <Tag color="#3cd45a" size="md">
            3
          </Tag>
          <Tag color="#3cd45a" size="sm">
            3
          </Tag>
        </div>
      </div>
      <div>
        <h4 className="mb-2 text-sm text-gray-500">Text + Icon type</h4>
        <div className="flex items-center gap-4">
          <Tag color="#3cd45a" size="lg" closable onClose={action('closed')}>
            Rachel Meyers
          </Tag>
          <Tag color="#3cd45a" size="md" closable onClose={action('closed')}>
            Rachel Meyers
          </Tag>
          <Tag color="#3cd45a" size="sm" closable onClose={action('closed')}>
            Rachel Meyers
          </Tag>
        </div>
      </div>
    </div>
  )
}

export const States: Story = {
  render: () => (
    <div className="flex flex-col gap-4">
      <div className="flex gap-2">
        <Tag color="#52c41a">Normal</Tag>
        <Tag color="#52c41a" disabled>
          Disabled
        </Tag>
        <Tag color="#52c41a" inactive>
          Inactive
        </Tag>
      </div>
      <div className="flex gap-2">
        <Tag color="#1890ff" onClick={action('clicked')}>
          Clickable
        </Tag>
        <Tag color="#fa541c" tooltip="This is a tooltip">
          With Tooltip
        </Tag>
      </div>
    </div>
  )
}

export const Colors: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      <Tag color="#3cd45a">Primary</Tag>
      <Tag color="#1890ff">Blue</Tag>
      <Tag color="#fa8c16">Orange</Tag>
      <Tag color="#fa541c">Red</Tag>
      <Tag color="#6495ED">Purple</Tag>
      <Tag color="#FFA500">Amber</Tag>
    </div>
  )
}

export const UseCases: Story = {
  render: () => (
    <div className="space-y-4">
      <div>
        <h4 className="mb-2 text-sm text-gray-500">Skill tags:</h4>
        <div className="flex flex-wrap gap-2">
          <Tag color="#1890ff">React</Tag>
          <Tag color="#52c41a">TypeScript</Tag>
          <Tag color="#fa8c16">Tailwind</Tag>
        </div>
      </div>
      <div>
        <h4 className="mb-2 text-sm text-gray-500">Status tags:</h4>
        <div className="flex gap-2">
          <Tag color="#52c41a" icon={<AlertTriangleIcon size={14} />}>
            In Progress
          </Tag>
          <Tag color="#fa541c" closable onClose={action('task-removed')}>
            Pending
          </Tag>
        </div>
      </div>
    </div>
  )
}
