import type { ColumnDef } from '@cherrystudio/ui'
import { Badge, Button, DataTable, Input } from '@cherrystudio/ui'
import type { Meta, StoryObj } from '@storybook/react'
import { Pencil, Trash2 } from 'lucide-react'
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

const columnsWithActions: ColumnDef<Task>[] = [
  ...columns,
  {
    id: 'actions',
    header: 'Actions',
    meta: { width: 96, maxWidth: 96, align: 'center' },
    cell: ({ row }) => (
      <div className="flex items-center justify-center gap-1">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="text-foreground-muted hover:bg-accent/70 hover:text-foreground"
          aria-label={`Edit ${row.original.name}`}>
          <Pencil className="size-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="text-destructive hover:bg-destructive/10 hover:text-destructive"
          aria-label={`Delete ${row.original.name}`}>
          <Trash2 className="size-4" />
        </Button>
      </div>
    )
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

export const WithActions: Story = {
  render: () => <DataTable className="w-[720px]" data={tasks} columns={columnsWithActions} rowKey="id" />
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
    const [selectedRowKey, setSelectedRowKey] = useState<Key | null>(null)

    return (
      <DataTable
        className="w-[640px]"
        data={tasks}
        columns={columns}
        rowKey="id"
        selection={{
          type: 'single',
          selectedRowKey,
          onChange: setSelectedRowKey
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
