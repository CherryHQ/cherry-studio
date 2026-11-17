import type { Meta, StoryObj } from '@storybook/react'
import { Database, FileText, Folder, KeyRound, Sparkles, Upload } from 'lucide-react'

import {
  Button,
  EmptyNote,
  EmptyPlaceholder,
  EmptyState,
  EmptyStateRow,
  EmptyStateScene,
  SceneButton,
  SceneCursor,
  SceneFloat,
  SceneGhostRow,
  SceneHeader,
  ScenePanel,
  SceneSlot,
  SceneTabs
} from '@cherrystudio/ui'

const meta: Meta<typeof EmptyState> = {
  title: 'Components/Composites/empty-state',
  component: EmptyState,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'A centered placeholder for empty lists, search results, and onboarding slots. Renders a unified line illustration (or a custom icon) with copy and up to two actions.'
      }
    }
  },
  tags: ['autodocs'],
  argTypes: {
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

export const WithSecondaryAction: Story = {
  render: () => (
    <Surface>
      <EmptyState
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

export const WithScene: Story = {
  render: () => (
    <Surface>
      <EmptyState
        title="No files yet"
        description="Files you upload or attach in chats appear here."
        actionLabel="Upload file"
        onAction={() => undefined}
        scene={
          <EmptyStateScene
            accent={1}
            sprites={[
              { x: 290, y: 2, color: 4, shape: 'ring', tilt: 10 },
              { x: 4, y: 90, color: 6, shape: 'corner', tilt: -12 },
              { x: 296, y: 150, color: 1, shape: 'checker', tilt: 8 }
            ]}>
            <ScenePanel className="absolute top-[13px] left-[21px] h-[220px] w-[270px]">
              <SceneHeader icon={Folder} title="Files" trailing={<SceneButton icon={Upload} label="Upload" />} />
              <div className="flex flex-col gap-[8px] px-[10px] pt-[8px]">
                <SceneTabs items={['All', 'Images', 'Documents']} />
                <SceneSlot accent className="h-[38px] justify-center gap-[5px] text-[8px] font-semibold">
                  <Upload size={10} strokeWidth={2} />
                  Drop files here
                </SceneSlot>
                <SceneGhostRow lead />
                <SceneGhostRow lead />
              </div>
            </ScenePanel>
            <SceneFloat className="top-[118px] left-[196px]">
              <ScenePanel className="h-[26px] w-[78px] -rotate-6 flex-row items-center gap-[5px] rounded-[6px] px-[6px]">
                <FileText size={11} className="shrink-0 text-muted-foreground" />
                <span className="truncate text-[7.3px] text-foreground">report.pdf</span>
              </ScenePanel>
              <SceneCursor className="top-[16px] left-[66px]" />
            </SceneFloat>
          </EmptyStateScene>
        }
      />
    </Surface>
  )
}

export const CompactTemplates: Story = {
  render: () => (
    <div className="flex w-[360px] flex-col gap-4">
      <EmptyStateRow icon={KeyRound}>No API key</EmptyStateRow>
      <EmptyPlaceholder
        icon={Database}
        title="No knowledge bases linked"
        description="Once linked, the assistant can answer from document content."
        action={
          <Button size="sm" variant="outline">
            Link
          </Button>
        }
      />
      <EmptyNote>No run history yet.</EmptyNote>
    </div>
  )
}
