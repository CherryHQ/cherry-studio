import { EmptyState } from '@cherrystudio/ui'
import type { Meta, StoryObj } from '@storybook/react'
import { Sparkles } from 'lucide-react'

const meta: Meta<typeof EmptyState> = {
  title: 'Components/Composites/EmptyState',
  component: EmptyState,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'A centered placeholder for empty lists, search results, and onboarding slots. Ships with presets for common Cherry Studio domains and accepts custom icons, copy, and actions.'
      }
    }
  },
  tags: ['autodocs'],
  argTypes: {
    preset: {
      control: { type: 'select' },
      options: [
        undefined,
        'no-model',
        'no-assistant',
        'no-agent',
        'no-knowledge',
        'no-file',
        'no-note',
        'no-miniapp',
        'no-code-tool',
        'no-resource',
        'no-translate',
        'no-result',
        'no-topic',
        'no-session'
      ]
    },
    compact: { control: 'boolean' }
  }
}

export default meta
type Story = StoryObj<typeof meta>

const Surface = ({ children }: { children: React.ReactNode }) => (
  <div className="flex h-96 w-[560px] items-center justify-center rounded-md border bg-card">{children}</div>
)

export const Default: Story = {
  render: () => (
    <Surface>
      <EmptyState
        title="No topics yet"
        description="Start a new conversation to see it show up here."
        actionLabel="New topic"
        onAction={() => undefined}
      />
    </Surface>
  )
}

export const WithPreset: Story = {
  render: () => (
    <Surface>
      <EmptyState
        preset="no-knowledge"
        title="No knowledge bases"
        description="Create a knowledge base to let assistants ground their answers in your documents."
        actionLabel="Create knowledge base"
        onAction={() => undefined}
        secondaryLabel="Learn more"
        onSecondary={() => undefined}
      />
    </Surface>
  )
}

export const Compact: Story = {
  render: () => (
    <div className="w-80 rounded-md border bg-card">
      <EmptyState
        compact
        preset="no-result"
        title="No matches"
        description="Try adjusting your search or filters."
        actionLabel="Clear filters"
        onAction={() => undefined}
      />
    </div>
  )
}

export const CustomIcon: Story = {
  render: () => (
    <Surface>
      <EmptyState icon={Sparkles} title="You're all caught up" description="No pending tasks. Enjoy the calm." />
    </Surface>
  )
}

export const AllPresets: Story = {
  render: () => (
    <div className="grid grid-cols-2 gap-4">
      {(
        [
          'no-model',
          'no-assistant',
          'no-agent',
          'no-knowledge',
          'no-file',
          'no-note',
          'no-miniapp',
          'no-code-tool',
          'no-resource',
          'no-translate',
          'no-result',
          'no-topic',
          'no-session'
        ] as const
      ).map((preset) => (
        <div key={preset} className="rounded-md border bg-card">
          <EmptyState compact preset={preset} title={preset} description={`Preset: ${preset}`} />
        </div>
      ))}
    </div>
  )
}
