import type { ColumnDef } from '@cherrystudio/ui'
import { Badge, Button, DataTable, Input } from '@cherrystudio/ui'
import type { Meta, StoryObj } from '@storybook/react'
import type { Key } from 'react'
import { useMemo, useState } from 'react'

type Task = {
  id: string
  name: string
  status: 'active' | 'paused' | 'completed'
  owner: string
  locked?: boolean
}

const tasks: Task[] = [
  { id: '1', name: 'Refresh index', status: 'active', owner: 'Ada' },
  { id: '2', name: 'Sync providers', status: 'paused', owner: 'Grace' },
  { id: '3', name: 'Archive logs', status: 'completed', owner: 'Linus', locked: true }
]

const columns: ColumnDef<Task>[] = [
  {
    accessorKey: 'name',
    header: 'Name',
    meta: { width: 220 }
  },
  {
    accessorKey: 'status',
    header: 'Status',
    meta: { width: 120 },
    cell: ({ row }) => <Badge variant="outline">{row.original.status}</Badge>
  },
  {
    accessorKey: 'owner',
    header: 'Owner'
  }
]

const meta: Meta<typeof DataTable<Task>> = {
  title: 'Components/Composites/DataTable',
  component: DataTable<Task>,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'A shadcn/TanStack-powered data table with Cherry Studio styling, optional max width, selection, header slots, empty state, scrolling, and controlled expanded rows.'
      }
    }
  },
  tags: ['autodocs']
}

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: () => <DataTable className="w-[640px]" data={tasks} columns={columns} rowKey="id" />
}

export const WithMaxWidth: Story = {
  render: () => (
    <div className="w-[800px] max-w-full">
      <DataTable data={tasks} columns={columns} rowKey="id" maxWidth={640} />
    </div>
  )
}

export const WithToolbar: Story = {
  render: function WithToolbarExample() {
    const [query, setQuery] = useState('')
    const filtered = useMemo(
      () => tasks.filter((task) => task.name.toLowerCase().includes(query.toLowerCase())),
      [query]
    )

    return (
      <DataTable
        className="w-[640px]"
        data={filtered}
        columns={columns}
        rowKey="id"
        headerLeft={<span className="text-muted-foreground text-sm">{filtered.length} tasks</span>}
        headerRight={
          <Input className="w-48" placeholder="Search tasks" value={query} onChange={(e) => setQuery(e.target.value)} />
        }
      />
    )
  }
}

export const MultipleSelection: Story = {
  render: function MultipleSelectionExample() {
    const [selectedRowKeys, setSelectedRowKeys] = useState<Key[]>(['1'])

    return (
      <DataTable
        className="w-[640px]"
        data={tasks}
        columns={columns}
        rowKey="id"
        selection={{
          type: 'multiple',
          selectedRowKeys,
          onChange: setSelectedRowKeys,
          getCheckboxProps: (task) => ({ disabled: task.locked })
        }}
        headerLeft={<span className="text-muted-foreground text-sm">{selectedRowKeys.length} selected</span>}
      />
    )
  }
}

export const SingleSelection: Story = {
  render: function SingleSelectionExample() {
    const [selectedRowKeys, setSelectedRowKeys] = useState<Key[]>([])

    return (
      <DataTable
        className="w-[640px]"
        data={tasks}
        columns={columns}
        rowKey="id"
        selection={{
          type: 'single',
          selectedRowKeys,
          onChange: setSelectedRowKeys
        }}
      />
    )
  }
}

export const Empty: Story = {
  render: () => <DataTable className="w-[640px]" data={[]} columns={columns} rowKey="id" emptyText="No tasks" />
}

export const ScrollAndExpand: Story = {
  render: function ScrollAndExpandExample() {
    const [expandedRowKeys, setExpandedRowKeys] = useState<Key[]>(['1'])

    return (
      <DataTable
        className="w-[640px]"
        data={[...tasks, ...tasks.map((task) => ({ ...task, id: `${task.id}-copy`, name: `${task.name} copy` }))]}
        columns={columns}
        rowKey="id"
        maxHeight={240}
        expandedRowKeys={expandedRowKeys}
        onExpandedRowChange={setExpandedRowKeys}
        renderExpandedRow={(task) => (
          <div className="flex items-center justify-between text-sm">
            <span>
              {task.name} is owned by {task.owner}.
            </span>
            <Button size="sm" variant="outline">
              Open
            </Button>
          </div>
        )}
      />
    )
  }
}
