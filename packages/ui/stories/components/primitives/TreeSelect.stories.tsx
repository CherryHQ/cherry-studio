import { TreeSelect, type TreeSelectOption } from '@cherrystudio/ui'
import type { Meta, StoryObj } from '@storybook/react'
import { FileText, Folder } from 'lucide-react'
import type { ComponentProps } from 'react'
import { useState } from 'react'

const treeData: TreeSelectOption[] = [
  {
    value: '',
    title: 'Root directory',
    icon: <Folder className="size-4" />,
    children: [
      {
        value: 'notes',
        title: 'Notes',
        icon: <Folder className="size-4" />,
        children: [
          {
            value: 'notes/daily.md',
            title: 'daily.md',
            icon: <FileText className="size-4" />
          },
          {
            value: 'notes/ideas.md',
            title: 'ideas.md',
            icon: <FileText className="size-4" />
          }
        ]
      },
      {
        value: 'archive',
        title: 'Archive',
        icon: <Folder className="size-4" />,
        children: [
          {
            value: 'archive/2025.md',
            title: '2025.md',
            icon: <FileText className="size-4" />
          }
        ]
      }
    ]
  }
]

const meta: Meta<typeof TreeSelect> = {
  title: 'Components/Primitives/TreeSelect',
  component: TreeSelect,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: 'A single-value tree select for choosing hierarchical options.'
      }
    }
  },
  tags: ['autodocs'],
  args: {
    treeData,
    placeholder: 'Select a path',
    searchPlaceholder: 'Search paths',
    emptyText: 'No paths found',
    width: 280
  }
}

export default meta
type Story = StoryObj<typeof meta>

export const Basic: Story = {}

function ControlledTreeSelect(args: ComponentProps<typeof TreeSelect>) {
  const [value, setValue] = useState('notes/daily.md')

  return <TreeSelect {...args} value={value} onChange={setValue} defaultExpandedValues={['', 'notes']} />
}

export const Controlled: Story = {
  render: (args) => <ControlledTreeSelect {...args} />
}

export const DefaultExpanded: Story = {
  args: {
    defaultExpandAll: true
  }
}
