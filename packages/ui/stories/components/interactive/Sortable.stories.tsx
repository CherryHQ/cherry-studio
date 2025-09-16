import type { Meta, StoryObj } from '@storybook/react-vite'
import clsx from 'clsx'
import React, { useMemo, useState } from 'react'

import { Sortable } from '../../../src/components/interactive/Sortable'
import { useDndReorder } from '../../../src/components/interactive/Sortable/useDndReorder'

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
          '基础拖拽排序组件，支持纵向/横向列表与网格布局。每个演示包含搜索框来筛选列表，并通过 useDndReorder 确保在“过滤视图”中拖拽时正确更新原始列表顺序。'
      }
    }
  },
  tags: ['autodocs'],
  argTypes: {
    gap: { control: 'text', description: 'CSS gap 值，如 8px、0.5rem、12px' },
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
      <div className="text-xs text-gray-500">ID: {item.id}</div>
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
    <div className="w-[720px] space-y-3">
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="搜索（模糊匹配 label）"
        className="w-full rounded-md border px-3 py-2 text-sm"
      />

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

      <p className="text-xs text-gray-500">
        在过滤后的列表中拖拽也会正确更新原始顺序（由 useDndReorder 处理索引映射）。
      </p>
    </div>
  )
}

function HorizontalDemo(args: any) {
  const { query, setQuery, filteredList, onSortEnd } = useExampleData()

  return (
    <div className="w-[720px] space-y-3">
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="搜索（模糊匹配 label）"
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
            <div className="min-w-[160px]">
              <ItemCard item={item} dragging={dragging} />
            </div>
          )}
        />
      </div>

      <p className="text-xs text-gray-500">可横向拖拽并支持溢出滚动。</p>
    </div>
  )
}

function GridDemo(args: any) {
  const { query, setQuery, filteredList, onSortEnd } = useExampleData()

  return (
    <div className="w-[900px] space-y-3">
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="搜索（模糊匹配 label）"
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

      <p className="text-xs text-gray-500">网格布局自动响应列宽，拖拽排序同样生效。</p>
    </div>
  )
}
