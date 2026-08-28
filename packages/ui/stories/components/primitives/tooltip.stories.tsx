import { NormalTooltip, Tooltip, TooltipContent, TooltipProvider, TooltipRoot, TooltipTrigger } from '@cherrystudio/ui'
import { Button } from '@cherrystudio/ui'
import type { Meta, StoryObj } from '@storybook/react'
import { Info } from 'lucide-react'

const meta: Meta<typeof Tooltip> = {
  title: 'Components/Primitives/Tooltip',
  component: Tooltip,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'A Radix-based tooltip with a flat convenience API (`Tooltip`), a compound API (`TooltipRoot` / `TooltipTrigger` / `TooltipContent`), and a quick wrapper (`NormalTooltip`).'
      }
    }
  },
  tags: ['autodocs']
}

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: () => (
    <Tooltip content="Add to library">
      <Button variant="outline">Hover me</Button>
    </Tooltip>
  )
}

export const Placements: Story = {
  render: () => (
    <div className="grid grid-cols-2 gap-4">
      {(['top', 'bottom', 'left', 'right', 'top-start', 'top-end', 'bottom-start', 'bottom-end'] as const).map(
        (placement) => (
          <Tooltip key={placement} content={`Placement: ${placement}`} placement={placement}>
            <Button variant="outline" className="w-36">
              {placement}
            </Button>
          </Tooltip>
        )
      )}
    </div>
  )
}

export const WithoutArrow: Story = {
  render: () => (
    <Tooltip content="No arrow here" showArrow={false}>
      <Button variant="outline">Hover</Button>
    </Tooltip>
  )
}

export const Disabled: Story = {
  render: () => (
    <Tooltip content="You won't see this" isDisabled>
      <Button variant="outline">Tooltip disabled</Button>
    </Tooltip>
  )
}

export const RichContent: Story = {
  render: () => (
    <Tooltip
      content={
        <div className="flex flex-col gap-1">
          <span className="font-semibold">Keyboard shortcut</span>
          <span className="text-xs text-muted-foreground">Press ⌘K to open the command palette.</span>
        </div>
      }>
      <Button variant="outline">Shortcuts</Button>
    </Tooltip>
  )
}

export const NormalTooltipExample: Story = {
  name: 'NormalTooltip',
  render: () => (
    <NormalTooltip content="Open in new tab" side="right">
      <Button variant="ghost" size="icon" aria-label="Info">
        <Info className="size-4" />
      </Button>
    </NormalTooltip>
  )
}

export const CompoundAPI: Story = {
  render: () => (
    <TooltipProvider>
      <TooltipRoot>
        <TooltipTrigger asChild>
          <Button variant="outline">Compound</Button>
        </TooltipTrigger>
        <TooltipContent>Built with TooltipRoot / Trigger / Content</TooltipContent>
      </TooltipRoot>
    </TooltipProvider>
  )
}
