import { DraggableList } from '@cherrystudio/ui'
import type { Meta, StoryObj } from '@storybook/react'
import { GripVertical } from 'lucide-react'
import { useState } from 'react'

const meta: Meta<typeof DraggableList> = {
  title: 'Components/Composites/DraggableList',
  component: DraggableList,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'A thin wrapper around `@hello-pangea/dnd` for vertical drag-and-drop lists. Pass your data via `list`, render each row with the children function, and handle reordered output through `onUpdate`.'
      }
    }
  },
  tags: ['autodocs']
}

export default meta
type Story = StoryObj<typeof meta>

interface Task {
  id: string
  title: string
}

const initial: Task[] = [
  { id: 't1', title: 'Draft release notes' },
  { id: 't2', title: 'Review pending PRs' },
  { id: 't3', title: 'Run regression suite' },
  { id: 't4', title: 'Schedule stakeholder sync' },
  { id: 't5', title: 'Publish changelog' }
]

export const Default: Story = {
  render: function DefaultExample() {
    const [list, setList] = useState<Task[]>(initial)
    return (
      <div className="w-96 rounded-md border bg-card p-3">
        <DraggableList list={list} onUpdate={setList} itemKey="id">
          {(item) => (
            <div className="flex items-center gap-2 rounded-md border bg-background px-3 py-2 text-sm shadow-xs">
              <GripVertical className="size-4 text-muted-foreground" />
              <span>{item.title}</span>
            </div>
          )}
        </DraggableList>
      </div>
    )
  }
}

export const StringList: Story = {
  render: function StringListExample() {
    const [list, setList] = useState<string[]>(['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo'])
    return (
      <div className="w-80 rounded-md border bg-card p-3">
        <DraggableList list={list} onUpdate={setList}>
          {(item, index) => (
            <div className="flex items-center justify-between rounded-md border bg-background px-3 py-2 text-sm">
              <span>{item}</span>
              <span className="text-xs text-muted-foreground">#{index + 1}</span>
            </div>
          )}
        </DraggableList>
      </div>
    )
  }
}
