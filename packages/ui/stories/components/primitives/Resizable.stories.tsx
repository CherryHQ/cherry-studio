import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@cherrystudio/ui'
import type { Meta, StoryObj } from '@storybook/react'

const meta: Meta<typeof ResizablePanelGroup> = {
  title: 'Components/Primitives/Resizable',
  component: ResizablePanelGroup,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'Composable resizable panels for split views. Use PanelGroup, Panel, and Handle together to build editor/preview layouts.'
      }
    }
  },
  tags: ['autodocs']
}

export default meta
type Story = StoryObj<typeof meta>

export const Horizontal: Story = {
  render: () => (
    <div className="h-80 w-[720px] rounded-md border border-border bg-background">
      <ResizablePanelGroup direction="horizontal">
        <ResizablePanel id="code" defaultSize={45} minSize={25}>
          <div className="flex h-full items-center justify-center bg-muted/40 text-sm text-muted-foreground">Code</div>
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel id="preview" defaultSize={55} minSize={25}>
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Preview</div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  )
}

export const Vertical: Story = {
  render: () => (
    <div className="h-80 w-[520px] rounded-md border border-border bg-background">
      <ResizablePanelGroup direction="vertical">
        <ResizablePanel id="main" defaultSize={65} minSize={30}>
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Main</div>
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel id="details" defaultSize={35} minSize={20}>
          <div className="flex h-full items-center justify-center bg-muted/40 text-sm text-muted-foreground">
            Details
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  )
}
