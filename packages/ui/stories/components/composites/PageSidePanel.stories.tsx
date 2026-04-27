import { Button, PageSidePanel } from '@cherrystudio/ui'
import type { Meta, StoryObj } from '@storybook/react'
import { useState } from 'react'

const meta: Meta<typeof PageSidePanel> = {
  title: 'Components/Composites/PageSidePanel',
  component: PageSidePanel,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'An in-page side drawer anchored to the nearest positioned parent — the rest of the page stays visible and interactive. Use the shadcn `Drawer` for a full-viewport modal instead.'
      }
    }
  },
  tags: ['autodocs']
}

export default meta
type Story = StoryObj<typeof meta>

const Scene = ({ side }: { side: 'left' | 'right' }) => {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative h-[520px] w-full overflow-hidden rounded-md border bg-card">
      <div className="flex items-start gap-3 p-6">
        <Button onClick={() => setOpen(true)}>Open {side} panel</Button>
        <p className="text-sm text-muted-foreground">
          The panel slides in from the {side}, anchored to this container.
        </p>
      </div>
      <PageSidePanel
        open={open}
        onClose={() => setOpen(false)}
        side={side}
        header={<span className="text-sm font-medium">Panel title</span>}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => setOpen(false)}>Save</Button>
          </div>
        }>
        <div className="space-y-3 text-sm">
          <p>Place any content here — settings, detail views, task editors.</p>
          <p className="text-muted-foreground">
            The panel traps focus while open and restores focus back to its opener when closed.
          </p>
        </div>
      </PageSidePanel>
    </div>
  )
}

export const Right: Story = {
  render: () => <Scene side="right" />
}

export const Left: Story = {
  render: () => <Scene side="left" />
}

export const WithoutCloseButton: Story = {
  render: function NoCloseExample() {
    const [open, setOpen] = useState(false)
    return (
      <div className="relative h-[520px] w-full overflow-hidden rounded-md border bg-card">
        <div className="p-6">
          <Button onClick={() => setOpen(true)}>Open panel</Button>
        </div>
        <PageSidePanel open={open} onClose={() => setOpen(false)} showCloseButton={false}>
          <div className="space-y-3 text-sm">
            <p>No close button in the header — rely on the backdrop, Escape, or a custom action to dismiss.</p>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Close from body
            </Button>
          </div>
        </PageSidePanel>
      </div>
    )
  }
}
