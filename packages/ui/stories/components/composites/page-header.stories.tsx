import type { Meta, StoryObj } from '@storybook/react-vite'
import { Filter, Plus } from 'lucide-react'

import { PageHeader } from '../../../src/components'

const meta: Meta<typeof PageHeader> = {
  title: 'Components/Composites/PageHeader',
  component: PageHeader,
  parameters: {
    layout: 'centered'
  },
  tags: ['autodocs']
}

export default meta
type Story = StoryObj<typeof meta>

// ---------------------------------------------------------------------------
// Default — title only
// ---------------------------------------------------------------------------

export const Default: Story = {
  render: () => (
    <div className="w-[260px] rounded-xl border border-border bg-background">
      <PageHeader title="设置" />
    </div>
  )
}

// ---------------------------------------------------------------------------
// WithAction — title + right-side icon button
// ---------------------------------------------------------------------------

export const WithAction: Story = {
  render: () => (
    <div className="w-[260px] rounded-xl border border-border bg-background">
      <PageHeader
        title="模型服务"
        action={
          <button
            type="button"
            aria-label="Filter"
            className="flex size-6 shrink-0 items-center justify-center rounded-md text-foreground/45 transition-colors hover:bg-accent hover:text-foreground/75">
            <Filter size={14} />
          </button>
        }
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// LongTitle — verifies truncate behavior
// ---------------------------------------------------------------------------

export const LongTitle: Story = {
  render: () => (
    <div className="w-[200px] rounded-xl border border-border bg-background">
      <PageHeader
        title="A very long page title that overflows the container"
        action={
          <button
            type="button"
            aria-label="Add"
            className="flex size-6 shrink-0 items-center justify-center rounded-md text-foreground/45 transition-colors hover:bg-accent hover:text-foreground/75">
            <Plus size={14} />
          </button>
        }
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// SideBySide — visual height alignment between two adjacent panels
// ---------------------------------------------------------------------------

export const SideBySide: Story = {
  render: () => (
    <div className="flex gap-0 rounded-xl border border-border bg-background">
      <div className="w-[220px] border-border border-r">
        <PageHeader title="设置" />
      </div>
      <div className="w-[260px]">
        <PageHeader
          title="模型服务"
          action={
            <button
              type="button"
              aria-label="Filter"
              className="flex size-6 shrink-0 items-center justify-center rounded-md text-foreground/45 transition-colors hover:bg-accent hover:text-foreground/75">
              <Filter size={14} />
            </button>
          }
        />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// SectionTitleStyle — page-level label as a group name (e.g. "Models" sitting
// next to in-list group labels). Use `titleClassName` to swap PageHeader's
// default heading typography for section-title typography while keeping the
// exact same outer geometry so two adjacent columns stay vertically aligned.
// ---------------------------------------------------------------------------

export const SectionTitleStyle: Story = {
  parameters: {
    docs: {
      description: {
        story:
          "When the page label itself is a group name that should match in-list group labels, pass `titleClassName` to render the heading in section-title typography (`text-xs text-foreground-muted font-normal leading-4`). The PageHeader's `mt-3 + h-8 + mb-2` outer geometry is preserved so the baseline stays aligned with a normal PageHeader in an adjacent column."
      }
    }
  },
  render: () => (
    <div className="flex gap-0 rounded-xl border border-border bg-background">
      <div className="w-[220px] border-border border-r">
        <PageHeader title="模型" titleClassName="font-normal text-foreground-muted text-xs leading-4" />
      </div>
      <div className="w-[260px]">
        <PageHeader title="模型服务" />
      </div>
    </div>
  )
}
