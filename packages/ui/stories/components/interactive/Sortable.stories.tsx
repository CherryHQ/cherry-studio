import type { Meta, StoryObj } from '@storybook/react-vite'
import clsx from 'clsx'
import { useMemo, useState } from 'react'

import { Sortable } from '../../../src/components/interactive/Sortable'
import { useDndReorder } from '../../../src/hooks'

type ExampleItem = { id: number; label: string }

const initialItems: ExampleItem[] = Array.from({ length: 18 }).map((_, i) => ({
  id: i + 1,
  label: `Item ${i + 1}`
}))

const meta: Meta<typeof Sortable> = {
  title: 'Interactive/Sortable',
  component: Sortable,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'A basic drag-and-drop sorting component that supports vertical/horizontal lists and grid layout. Each demo includes a search box to filter items, and useDndReorder ensures drags in the filtered view correctly update the original list order.'
      }
    }
  },
  tags: ['autodocs'],
  argTypes: {
    gap: { control: 'text', description: 'CSS gap value, e.g., 8px, 0.5rem, 12px' },
    useDragOverlay: { control: 'boolean' },
    showGhost: { control: 'boolean' }
  },
  args: {
    gap: '8px',
    useDragOverlay: true,
    showGhost: false
  }
}

export default meta
type Story = StoryObj<typeof meta>

function useExampleData() {
  const [originalList, setOriginalList] = useState<ExampleItem[]>(initialItems)
  const [query, setQuery] = useState('')

  const filteredList = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return originalList
    return originalList.filter((x) => x.label.toLowerCase().includes(q))
  }, [query, originalList])

  const { onSortEnd } = useDndReorder<ExampleItem>({
    originalList,
    filteredList,
    onUpdate: setOriginalList,
    itemKey: 'id'
  })

  return { originalList, setOriginalList, query, setQuery, filteredList, onSortEnd }
}

function ItemCard({ item, dragging }: { item: ExampleItem; dragging: boolean }) {
  return (
    <div
      className={clsx(
        'select-none rounded-md border p-3 shadow-sm transition',
        dragging ? 'opacity-50 ring-2 ring-blue-400' : 'bg-white'
      )}>
      <div className="text-sm font-medium">{item.label}</div>
    </div>
  )
}

export const Vertical: Story = {
  render: (args) => <VerticalDemo {...(args as any)} />
}

export const Horizontal: Story = {
  render: (args) => <HorizontalDemo {...(args as any)} />
}

export const Grid: Story = {
  render: (args) => <GridDemo {...(args as any)} />
}

function VerticalDemo(args: any) {
  const { query, setQuery, filteredList, onSortEnd } = useExampleData()

  return (
    <div className="w-full space-y-3">
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search (fuzzy match label)"
        className="w-full rounded-md border px-3 py-2 text-sm"
      />

      <div className="overflow-x-auto h-[500px]">
        <Sortable<ExampleItem>
          items={filteredList}
          itemKey="id"
          onSortEnd={onSortEnd}
          layout="list"
          horizontal={false}
          gap={args.gap as string}
          useDragOverlay={args.useDragOverlay as boolean}
          showGhost={args.showGhost as boolean}
          renderItem={(item, { dragging }) => (
            <div className="min-w-[200px]">
              <ItemCard item={item} dragging={dragging} />
            </div>
          )}
        />
      </div>

      <p className="text-xs text-gray-500">
        Dragging within a filtered view correctly updates the original order (handled by useDndReorder).
      </p>
    </div>
  )
}

function HorizontalDemo(args: any) {
  const { query, setQuery, filteredList, onSortEnd } = useExampleData()

  return (
    <div className="w-full space-y-3">
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search (fuzzy match label)"
        className="w-full rounded-md border px-3 py-2 text-sm"
      />

      <div className="overflow-x-auto">
        <Sortable<ExampleItem>
          items={filteredList}
          itemKey="id"
          onSortEnd={onSortEnd}
          layout="list"
          horizontal
          gap={args.gap as string}
          useDragOverlay={args.useDragOverlay as boolean}
          showGhost={args.showGhost as boolean}
          renderItem={(item, { dragging }) => (
            <div className="min-w-[100px]">
              <ItemCard item={item} dragging={dragging} />
            </div>
          )}
        />
      </div>

      <p className="text-xs text-gray-500">Horizontal dragging with overflow scrolling.</p>
    </div>
  )
}

function GridDemo(args: any) {
  const { query, setQuery, filteredList, onSortEnd } = useExampleData()

  return (
    <div className="w-full space-y-3">
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search (fuzzy match label)"
        className="w-full rounded-md border px-3 py-2 text-sm"
      />

      <Sortable<ExampleItem>
        items={filteredList}
        itemKey="id"
        onSortEnd={onSortEnd}
        layout="grid"
        gap={(args.gap as string) ?? '12px'}
        useDragOverlay={args.useDragOverlay as boolean}
        showGhost={args.showGhost as boolean}
        renderItem={(item, { dragging }) => <ItemCard item={item} dragging={dragging} />}
      />

      <p className="text-xs text-gray-500">Responsive grid layout with drag-and-drop sorting.</p>
    </div>
  )
}
