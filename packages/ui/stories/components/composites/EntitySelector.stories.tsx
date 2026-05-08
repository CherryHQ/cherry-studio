import { Button } from '@cherrystudio/ui/components/primitives/button'
import { Checkbox } from '@cherrystudio/ui/components/primitives/checkbox'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { ArrowDown, ArrowUp, Check, ChevronRight, Pencil, Pin, PinOff, Plus } from 'lucide-react'
import { useMemo, useState } from 'react'

import { EntitySelector } from '../../../src/components/composites/EntitySelector'

type ExampleItem = { id: string; name: string; description?: string; emoji?: string }

const ITEMS: ExampleItem[] = [
  { id: 'item-1', name: 'Item 1', description: 'Description for item 1', emoji: '📦' },
  { id: 'item-2', name: 'Item 2', emoji: '✏️' },
  { id: 'item-3', name: 'Item 3', emoji: '🌐' },
  { id: 'item-4', name: 'Item 4', description: 'Description for item 4', emoji: '📊' },
  { id: 'item-5', name: 'Item 5', emoji: '🎓' },
  { id: 'item-6', name: 'Item 6', emoji: '📋' },
  { id: 'item-7', name: 'Item 7', description: 'Description for item 7', emoji: '⚖️' },
  { id: 'item-8', name: 'Item 8', emoji: '🎨' }
]

const EMPTY_STATE = <div className="px-3 py-6 text-center text-xs text-muted-foreground/60">No matches</div>

/**
 * Reference row renderer used across stories. Real consumers (AssistantSelector, etc.) supply their own.
 */
function ExampleRow({
  item,
  isSelected,
  isMultiMode,
  isActive,
  onSelect,
  onContextMenu
}: {
  item: ExampleItem
  isSelected: boolean
  isMultiMode: boolean
  isActive: boolean
  onSelect: () => void
  onContextMenu?: (e: React.MouseEvent) => void
}) {
  return (
    <div
      onClick={onSelect}
      onContextMenu={onContextMenu}
      className={`group flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors hover:bg-accent/50 ${
        isActive ? 'bg-accent/40' : ''
      } ${isMultiMode && isSelected ? 'bg-accent/60' : ''}`}>
      <span className="flex size-4 shrink-0 items-center justify-center">
        {isMultiMode ? (
          <Checkbox size="sm" checked={isSelected} onClick={(e) => e.stopPropagation()} onCheckedChange={onSelect} />
        ) : isSelected ? (
          <Check className="size-4 text-primary" strokeWidth={2.5} />
        ) : null}
      </span>
      {item.emoji ? (
        <span className="flex size-5 shrink-0 items-center justify-center text-base">{item.emoji}</span>
      ) : null}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-foreground">{item.name}</span>
        {item.description ? (
          <span className="truncate text-xs text-muted-foreground/70">{item.description}</span>
        ) : null}
      </span>
    </div>
  )
}

const meta: Meta<typeof EntitySelector> = {
  title: 'Components/Composites/EntitySelector',
  component: EntitySelector,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'Generic selector composite — pure structural shell. The composite owns: trigger/popover, search input container, filter toggle position, multi-select toolbar, list scroll container, row click/hover/context-menu plumbing, context-menu portal, and footer container. All visuals (rows, filter panel, context-menu content, footer content) are slots the consumer fills in. Items are rendered in the exact order given — caller does all sorting and filtering.'
      }
    }
  },
  tags: ['autodocs']
}

export default meta
// Decoupled from the component's generic props because each story uses `render` with its own
// Demo component — we never pass args through meta, so tying Story to `typeof meta` pins args
// to `never` and forces a useless `args: {}` on every entry.
type Story = StoryObj

function DefaultDemo() {
  const [value, setValue] = useState<string>('item-1')
  return (
    <EntitySelector
      trigger={<Button variant="outline">Open</Button>}
      items={ITEMS}
      mode="single"
      value={value}
      onChange={(next) => setValue(next as string)}
      renderItem={(item, ctx) => <ExampleRow item={item} {...ctx} />}
    />
  )
}

export const Default: Story = {
  parameters: {
    docs: {
      description: {
        story: 'Bare minimum: trigger + items + renderItem. No search, no filter, no multi, no context menu, no footer.'
      }
    }
  },
  render: () => <DefaultDemo />
}

function WithSearchDemo() {
  const [value, setValue] = useState<string>('item-1')
  const [query, setQuery] = useState('')
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return ITEMS
    return ITEMS.filter((it) => it.name.toLowerCase().includes(q))
  }, [query])
  return (
    <EntitySelector
      trigger={<Button variant="outline">Open</Button>}
      items={filtered}
      mode="single"
      value={value}
      onChange={(next) => setValue(next as string)}
      search={{ value: query, onChange: setQuery, placeholder: 'Search…' }}
      renderItem={(item, ctx) => <ExampleRow item={item} {...ctx} />}
      emptyState={EMPTY_STATE}
    />
  )
}

export const WithSearch: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'Search input is controlled — caller filters items and passes the result. Composite does not filter on its own.'
      }
    }
  },
  render: () => <WithSearchDemo />
}

function WithFilterPanelSlotDemo() {
  const [value, setValue] = useState<string>('item-1')
  const [tags, setTags] = useState<string[]>([])
  const [sort, setSort] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  const toggleTag = (id: string) =>
    setTags((prev) => (prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]))

  return (
    <EntitySelector
      trigger={<Button variant="outline">Open</Button>}
      items={ITEMS}
      mode="single"
      value={value}
      onChange={(next) => setValue(next as string)}
      search={{ value: query, onChange: setQuery, placeholder: 'Search…' }}
      renderItem={(item, ctx) => <ExampleRow item={item} {...ctx} />}
      filterActive={tags.length > 0 || sort !== null}
      filterPanel={
        <div className="space-y-2">
          <div className="flex flex-wrap gap-1.5">
            {['Tag A', 'Tag B', 'Tag C', 'Tag D'].map((label, i) => {
              const id = `tag-${i + 1}`
              const active = tags.includes(id)
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => toggleTag(id)}
                  className={`rounded-full border px-2.5 py-0.5 text-xs transition-colors ${
                    active
                      ? 'border-primary/40 bg-primary/10 text-foreground'
                      : 'border-border/60 text-muted-foreground/80 hover:bg-accent/50'
                  }`}>
                  {label}
                </button>
              )
            })}
          </div>
          <div className="flex items-center gap-1.5">
            <span className="mr-1 text-xs text-muted-foreground/60">Sort</span>
            {[
              { id: 'asc', label: 'Asc', icon: <ArrowUp className="size-3" /> },
              { id: 'desc', label: 'Desc', icon: <ArrowDown className="size-3" /> }
            ].map(({ id, label, icon }) => {
              const active = sort === id
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setSort(active ? null : id)}
                  className={`flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs transition-colors ${
                    active
                      ? 'border-primary/40 bg-primary/10 text-foreground'
                      : 'border-border/60 text-muted-foreground/80 hover:bg-accent/50'
                  }`}>
                  {icon}
                  {label}
                </button>
              )
            })}
          </div>
        </div>
      }
      emptyState={EMPTY_STATE}
    />
  )
}

export const WithFilterPanelSlot: Story = {
  parameters: {
    docs: {
      description: {
        story:
          '`filterPanel` is a slot — caller renders any UI. `filterActive` controls the in-input toggle button accent.'
      }
    }
  },
  render: () => <WithFilterPanelSlotDemo />
}

function WithMultiSelectDemo() {
  const [single, setSingle] = useState<string>('item-1')
  const [multi, setMulti] = useState<string[]>([])
  const [enabled, setEnabled] = useState(false)
  return (
    <EntitySelector
      trigger={<Button variant="outline">Open</Button>}
      items={ITEMS}
      mode={enabled ? 'multi' : 'single'}
      value={enabled ? multi : single}
      onChange={(next) => {
        if (enabled) setMulti(next as string[])
        else setSingle(next as string)
      }}
      renderItem={(item, ctx) => <ExampleRow item={item} {...ctx} />}
      multiSelect={{
        enabled,
        onEnabledChange: setEnabled,
        label: 'Multi-select',
        hint: '(label slot accepts any node)'
      }}
    />
  )
}

export const WithMultiSelect: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'Multi-select toolbar drives the row context: when enabled, `ctx.isMultiMode` is true so `renderItem` shows a checkbox instead of a checkmark.'
      }
    }
  },
  render: () => <WithMultiSelectDemo />
}

function WithContextMenuSlotDemo() {
  const [value, setValue] = useState<string>('item-1')
  return (
    <EntitySelector
      trigger={<Button variant="outline">Open (right-click rows)</Button>}
      items={ITEMS}
      mode="single"
      value={value}
      onChange={(next) => setValue(next as string)}
      renderItem={(item, ctx) => <ExampleRow item={item} {...ctx} />}
      renderItemContextMenu={(item, { close }) => (
        <div className="min-w-[140px] rounded-md border border-border/60 bg-popover p-1 shadow-md">
          <button
            type="button"
            onClick={() => {
              alert(`Edit ${item.id}`)
              close()
            }}
            className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent">
            <Pencil className="size-3.5" />
            Edit
          </button>
        </div>
      )}
    />
  )
}

export const WithContextMenuSlot: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'Right-click any row. The composite handles portal + position + dismiss; the menu UI is fully consumer-supplied.'
      }
    }
  },
  render: () => <WithContextMenuSlotDemo />
}

function WithFooterSlotDemo() {
  const [value, setValue] = useState<string>('item-1')
  return (
    <EntitySelector
      trigger={<Button variant="outline">Open</Button>}
      items={ITEMS}
      mode="single"
      value={value}
      onChange={(next) => setValue(next as string)}
      renderItem={(item, ctx) => <ExampleRow item={item} {...ctx} />}
      footer={
        <button
          type="button"
          onClick={() => alert('Create')}
          className="flex w-full items-center gap-2 border-t border-border/40 px-3 py-2.5 text-sm text-foreground hover:bg-accent/50">
          <Plus className="size-4 text-muted-foreground/80" />
          <span className="flex-1 text-left">Create new</span>
          <ChevronRight className="size-4 text-muted-foreground/60" />
        </button>
      }
    />
  )
}

export const WithFooterSlot: Story = {
  parameters: {
    docs: {
      description: {
        story: '`footer` accepts any node. Render whatever shape — multi-row, multi-action, divider, etc.'
      }
    }
  },
  render: () => <WithFooterSlotDemo />
}

type RichItem = ExampleItem & { tagIds: string[]; createdAt: number }
const ALL_TAGS = [
  { id: 'tag-a', label: 'Tag A' },
  { id: 'tag-b', label: 'Tag B' },
  { id: 'tag-c', label: 'Tag C' },
  { id: 'tag-d', label: 'Tag D' }
]
const RICH_ITEMS: RichItem[] = ITEMS.map((it, i) => ({
  ...it,
  tagIds: [`tag-${'abcd'[i % 4]}`],
  createdAt: i
}))

function FullFeaturedDemo() {
  const [single, setSingle] = useState<string>('item-1')
  const [multi, setMulti] = useState<string[]>([])
  const [enabled, setEnabled] = useState(false)
  const [pinnedIds, setPinnedIds] = useState<string[]>(['item-3'])
  const [query, setQuery] = useState('')
  const [tagIds, setTagIds] = useState<string[]>([])
  const [sort, setSort] = useState<string | null>('desc')

  const visibleItems = useMemo(() => {
    let next: RichItem[] = RICH_ITEMS
    if (tagIds.length) {
      const wanted = new Set(tagIds)
      next = next.filter((it) => it.tagIds.some((t) => wanted.has(t)))
    }
    const q = query.trim().toLowerCase()
    if (q) next = next.filter((it) => it.name.toLowerCase().includes(q))
    if (sort) {
      next = [...next].sort((a, b) => (sort === 'desc' ? b.createdAt - a.createdAt : a.createdAt - b.createdAt))
    }
    const pinnedSet = new Set(pinnedIds)
    const pinned = pinnedIds.map((id) => next.find((it) => it.id === id)).filter(Boolean) as RichItem[]
    const rest = next.filter((it) => !pinnedSet.has(it.id))
    return [...pinned, ...rest]
  }, [tagIds, query, sort, pinnedIds])

  const toggleTag = (id: string) =>
    setTagIds((prev) => (prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]))

  return (
    <EntitySelector
      trigger={<Button variant="outline">Open (full featured)</Button>}
      items={visibleItems}
      mode={enabled ? 'multi' : 'single'}
      value={enabled ? multi : single}
      onChange={(next) => {
        if (enabled) setMulti(next as string[])
        else setSingle(next as string)
      }}
      search={{ value: query, onChange: setQuery, placeholder: 'Search…' }}
      renderItem={(item, ctx) => <ExampleRow item={item} {...ctx} />}
      emptyState={EMPTY_STATE}
      filterActive={tagIds.length > 0 || sort !== null}
      filterPanel={
        <div className="space-y-2">
          <div className="flex flex-wrap gap-1.5">
            {ALL_TAGS.map((t) => {
              const active = tagIds.includes(t.id)
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => toggleTag(t.id)}
                  className={`rounded-full border px-2.5 py-0.5 text-xs transition-colors ${
                    active
                      ? 'border-primary/40 bg-primary/10 text-foreground'
                      : 'border-border/60 text-muted-foreground/80 hover:bg-accent/50'
                  }`}>
                  {t.label}
                </button>
              )
            })}
          </div>
          <div className="flex items-center gap-1.5">
            <span className="mr-1 text-xs text-muted-foreground/60">Sort</span>
            {[
              { id: 'desc', label: 'Desc', icon: <ArrowDown className="size-3" /> },
              { id: 'asc', label: 'Asc', icon: <ArrowUp className="size-3" /> }
            ].map(({ id, label, icon }) => {
              const active = sort === id
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setSort(active ? null : id)}
                  className={`flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs transition-colors ${
                    active
                      ? 'border-primary/40 bg-primary/10 text-foreground'
                      : 'border-border/60 text-muted-foreground/80 hover:bg-accent/50'
                  }`}>
                  {icon}
                  {label}
                </button>
              )
            })}
          </div>
        </div>
      }
      multiSelect={{
        enabled,
        onEnabledChange: setEnabled,
        label: 'Multi-select',
        hint: '(label slot accepts any node)'
      }}
      renderItemContextMenu={(item, { close }) => {
        const isPinned = pinnedIds.includes(item.id)
        return (
          <div className="min-w-[140px] rounded-md border border-border/60 bg-popover p-1 shadow-md">
            <button
              type="button"
              onClick={() => {
                alert(`Edit ${item.id}`)
                close()
              }}
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent">
              <Pencil className="size-3.5" />
              Edit
            </button>
            <button
              type="button"
              disabled={enabled}
              onClick={() => {
                setPinnedIds((prev) =>
                  prev.includes(item.id) ? prev.filter((id) => id !== item.id) : [...prev, item.id]
                )
                close()
              }}
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50">
              {isPinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
              {isPinned ? 'Unpin' : 'Pin'}
            </button>
          </div>
        )
      }}
      footer={
        <button
          type="button"
          onClick={() => alert('Create')}
          className="flex w-full items-center gap-2 border-t border-border/40 px-3 py-2.5 text-sm text-foreground hover:bg-accent/50">
          <Plus className="size-4 text-muted-foreground/80" />
          <span className="flex-1 text-left">Create new</span>
          <ChevronRight className="size-4 text-muted-foreground/60" />
        </button>
      }
    />
  )
}

export const FullFeatured: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'All regions wired together — search, filter panel (tags + sort), multi-select toolbar, pin-to-top, context menu (edit + pin), footer. Demonstrates how the consumer layer composes everything on top of the structural shell.'
      }
    }
  },
  render: () => <FullFeaturedDemo />
}

function ConsumerManagedSortDemo() {
  const [value, setValue] = useState<string>('item-1')
  const [pinnedIds, setPinnedIds] = useState<string[]>(['item-3'])

  const sortedItems = useMemo(() => {
    const pinnedSet = new Set(pinnedIds)
    const pinned = pinnedIds.map((id) => ITEMS.find((it) => it.id === id)).filter(Boolean) as ExampleItem[]
    const rest = ITEMS.filter((it) => !pinnedSet.has(it.id))
    return [...pinned, ...rest]
  }, [pinnedIds])

  return (
    <EntitySelector
      trigger={<Button variant="outline">Open (right-click to pin)</Button>}
      items={sortedItems}
      mode="single"
      value={value}
      onChange={(next) => setValue(next as string)}
      renderItem={(item, ctx) => <ExampleRow item={item} {...ctx} />}
      renderItemContextMenu={(item, { close }) => {
        const isPinned = pinnedIds.includes(item.id)
        return (
          <div className="min-w-[140px] rounded-md border border-border/60 bg-popover p-1 shadow-md">
            <button
              type="button"
              onClick={() => {
                setPinnedIds((prev) =>
                  prev.includes(item.id) ? prev.filter((id) => id !== item.id) : [...prev, item.id]
                )
                close()
              }}
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent">
              {isPinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
              {isPinned ? 'Unpin' : 'Pin'}
            </button>
          </div>
        )
      }}
    />
  )
}

export const ConsumerManagedSort: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'Pin/sort is the consumer’s job. This story keeps a `pinnedIds` set, sorts items so pinned float to top, and exposes pin/unpin via the context-menu slot.'
      }
    }
  },
  render: () => <ConsumerManagedSortDemo />
}

function WithSectionsDemo() {
  const [value, setValue] = useState<string>('item-1')
  const [pinnedIds, setPinnedIds] = useState<string[]>(['item-3'])

  const { pinnedItems, restItems } = useMemo(() => {
    const pinnedSet = new Set(pinnedIds)
    const pinned = pinnedIds.map((id) => ITEMS.find((it) => it.id === id)).filter(Boolean) as ExampleItem[]
    const rest = ITEMS.filter((it) => !pinnedSet.has(it.id))
    return { pinnedItems: pinned, restItems: rest }
  }, [pinnedIds])

  const sectionHeader = (label: string) => (
    <div className="px-3 pt-2 pb-1 text-muted-foreground/50 text-xs">{label}</div>
  )

  return (
    <EntitySelector
      trigger={<Button variant="outline">Open (pinned group)</Button>}
      sections={[
        ...(pinnedItems.length > 0 ? [{ key: 'pinned', header: sectionHeader('Pinned'), items: pinnedItems }] : []),
        { key: 'rest', header: sectionHeader('All'), items: restItems }
      ]}
      mode="single"
      value={value}
      onChange={(next) => setValue(next as string)}
      renderItem={(item, ctx) => <ExampleRow item={item} {...ctx} />}
      renderItemContextMenu={(item, { close }) => {
        const isPinned = pinnedIds.includes(item.id)
        return (
          <div className="min-w-[140px] rounded-md border border-border/60 bg-popover p-1 shadow-md">
            <button
              type="button"
              onClick={() => {
                setPinnedIds((prev) =>
                  prev.includes(item.id) ? prev.filter((id) => id !== item.id) : [...prev, item.id]
                )
                close()
              }}
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent">
              {isPinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
              {isPinned ? 'Unpin' : 'Pin'}
            </button>
          </div>
        )
      }}
    />
  )
}

export const WithSections: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'Use `sections` instead of flat `items` when the list needs non-item rows interleaved (e.g. a "Pinned" heading above pinned rows). Headers are presentational — keyboard navigation walks across sections as if flat.'
      }
    }
  },
  render: () => <WithSectionsDemo />
}
