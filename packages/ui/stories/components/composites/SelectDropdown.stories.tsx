import { Badge, SelectDropdown } from '@cherrystudio/ui'
import type { Meta, StoryObj } from '@storybook/react'
import { Bot } from 'lucide-react'
import { useMemo, useState } from 'react'

const meta: Meta<typeof SelectDropdown> = {
  title: 'Components/Composites/SelectDropdown',
  component: SelectDropdown,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'A generic popover-based select that lets callers render their own trigger preview and item rows. Supports removal, empty state, and virtualization for long lists.'
      }
    }
  },
  tags: ['autodocs']
}

export default meta
type Story = StoryObj<typeof meta>

interface Model {
  id: string
  name: string
  provider: string
}

const models: Model[] = [
  { id: 'gpt-4o', name: 'GPT-4o', provider: 'OpenAI' },
  { id: 'gpt-4o-mini', name: 'GPT-4o mini', provider: 'OpenAI' },
  { id: 'claude-opus-4', name: 'Claude Opus 4', provider: 'Anthropic' },
  { id: 'claude-sonnet-4', name: 'Claude Sonnet 4', provider: 'Anthropic' },
  { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', provider: 'Google' },
  { id: 'qwen-max', name: 'Qwen Max', provider: 'Alibaba' }
]

export const Default: Story = {
  render: function DefaultExample() {
    const [selected, setSelected] = useState<string>('gpt-4o')
    return (
      <div className="w-72">
        <SelectDropdown<Model>
          items={models}
          selectedId={selected}
          onSelect={setSelected}
          renderSelected={(item) => <span className="truncate">{item.name}</span>}
          renderItem={(item) => (
            <div className="flex min-w-0 flex-col">
              <span className="truncate font-medium">{item.name}</span>
              <span className="truncate text-muted-foreground/70">{item.provider}</span>
            </div>
          )}
          renderTriggerLeading={<Bot size={12} className="text-muted-foreground" />}
          placeholder="Select a model"
        />
      </div>
    )
  }
}

export const Removable: Story = {
  render: function RemovableExample() {
    const [items, setItems] = useState(models.slice(0, 4))
    const [selected, setSelected] = useState<string | null>(items[0]?.id ?? null)
    return (
      <div className="w-72">
        <SelectDropdown<Model>
          items={items}
          selectedId={selected}
          onSelect={setSelected}
          onRemove={(id) => {
            setItems((prev) => prev.filter((m) => m.id !== id))
            if (selected === id) setSelected(null)
          }}
          removeLabel="Remove"
          renderSelected={(item) => <span className="truncate">{item.name}</span>}
          renderItem={(item) => <span className="truncate">{item.name}</span>}
          emptyText="No models left"
          placeholder="Pick a model"
        />
      </div>
    )
  }
}

export const Virtualized: Story = {
  render: function VirtualizedExample() {
    const items = useMemo(
      () =>
        Array.from({ length: 400 }, (_, i) => ({
          id: `item-${i}`,
          name: `Model ${i.toString().padStart(3, '0')}`,
          provider: i % 2 === 0 ? 'OpenAI' : 'Anthropic'
        })),
      []
    )
    const [selected, setSelected] = useState<string>('item-0')
    return (
      <div className="w-72">
        <SelectDropdown<Model>
          virtualize
          items={items}
          selectedId={selected}
          onSelect={setSelected}
          renderSelected={(item) => <span className="truncate">{item.name}</span>}
          renderItem={(item, isSelected) => (
            <div className="flex items-center justify-between gap-2">
              <span className="truncate">{item.name}</span>
              {isSelected && <Badge className="h-4">current</Badge>}
            </div>
          )}
          maxHeight={280}
        />
      </div>
    )
  }
}

export const Empty: Story = {
  render: () => (
    <div className="w-72">
      <SelectDropdown<Model>
        items={[]}
        selectedId={null}
        onSelect={() => undefined}
        renderSelected={(item) => <span>{item.name}</span>}
        renderItem={(item) => <span>{item.name}</span>}
        placeholder="No options"
        emptyText="Nothing to pick yet"
      />
    </div>
  )
}
