import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger
} from '@cherrystudio/ui'
import type { Meta, StoryObj } from '@storybook/react'
import { Copy, Download, Pencil, Settings, Trash2 } from 'lucide-react'
import { useState } from 'react'

const meta: Meta<typeof ContextMenu> = {
  title: 'Components/Primitives/ContextMenu',
  component: ContextMenu,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'Displays a menu when right-clicking a trigger area. Built on Radix UI Context Menu and styled with shadcn tokens.'
      }
    }
  },
  tags: ['autodocs']
}

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: () => (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div className="flex h-36 w-72 items-center justify-center rounded-md border border-dashed bg-background-subtle text-sm text-muted-foreground">
          Right click this area
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-48">
        <ContextMenuItem>
          <Pencil />
          Rename
          <ContextMenuShortcut>F2</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem>
          <Copy />
          Duplicate
          <ContextMenuShortcut>⌘D</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem>
          <Download />
          Export
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem variant="destructive">
          <Trash2 />
          Delete
          <ContextMenuShortcut>⌘⌫</ContextMenuShortcut>
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

export const WithSubMenu: Story = {
  render: () => (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div className="flex h-36 w-72 items-center justify-center rounded-md border border-dashed bg-background-subtle text-sm text-muted-foreground">
          Right click for nested actions
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-52">
        <ContextMenuLabel>Provider</ContextMenuLabel>
        <ContextMenuItem>
          <Pencil />
          Edit
        </ContextMenuItem>
        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <Settings />
            More actions
          </ContextMenuSubTrigger>
          <ContextMenuSubContent className="w-40">
            <ContextMenuItem>Open settings</ContextMenuItem>
            <ContextMenuItem>View logs</ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem variant="destructive">Reset</ContextMenuItem>
          </ContextMenuSubContent>
        </ContextMenuSub>
      </ContextMenuContent>
    </ContextMenu>
  )
}

export const CheckboxAndRadioItems: Story = {
  render: function CheckboxAndRadioItemsExample() {
    const [showBadge, setShowBadge] = useState(true)
    const [density, setDensity] = useState('comfortable')

    return (
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div className="flex h-36 w-72 items-center justify-center rounded-md border border-dashed bg-background-subtle text-sm text-muted-foreground">
            Right click for selectable items
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent className="w-56">
          <ContextMenuCheckboxItem checked={showBadge} onCheckedChange={setShowBadge}>
            Show status badge
          </ContextMenuCheckboxItem>
          <ContextMenuSeparator />
          <ContextMenuLabel inset>Density</ContextMenuLabel>
          <ContextMenuRadioGroup value={density} onValueChange={setDensity}>
            <ContextMenuRadioItem value="compact">Compact</ContextMenuRadioItem>
            <ContextMenuRadioItem value="comfortable">Comfortable</ContextMenuRadioItem>
            <ContextMenuRadioItem value="spacious">Spacious</ContextMenuRadioItem>
          </ContextMenuRadioGroup>
        </ContextMenuContent>
      </ContextMenu>
    )
  }
}
