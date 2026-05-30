import {
  Button,
  Input,
  Label,
  MenuItem,
  MenuList,
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger
} from '@cherrystudio/ui'
import type { Meta, StoryObj } from '@storybook/react'
import { Check, CopyPlus, Edit, Trash2, UserPen } from 'lucide-react'

const meta: Meta<typeof Popover> = {
  title: 'Components/Primitives/Popover',
  component: Popover,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: 'Displays rich content in a portal triggered by a button. Based on Radix UI Popover.'
      }
    }
  },
  tags: ['autodocs']
}

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: () => (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline">Open popover</Button>
      </PopoverTrigger>
      <PopoverContent>
        <div className="grid gap-2">
          <h4 className="text-sm font-medium">Dimensions</h4>
          <p className="text-xs text-muted-foreground">Set the dimensions for the layer.</p>
        </div>
      </PopoverContent>
    </Popover>
  )
}

export const WithForm: Story = {
  render: () => (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline">Edit profile</Button>
      </PopoverTrigger>
      <PopoverContent className="w-80">
        <div className="grid gap-4">
          <div className="space-y-1">
            <h4 className="text-sm font-medium">Profile</h4>
            <p className="text-xs text-muted-foreground">Update your display name and handle.</p>
          </div>
          <div className="grid gap-3">
            <div className="grid grid-cols-3 items-center gap-2">
              <Label htmlFor="name">Name</Label>
              <Input id="name" defaultValue="Cherry" className="col-span-2 h-8" />
            </div>
            <div className="grid grid-cols-3 items-center gap-2">
              <Label htmlFor="handle">Handle</Label>
              <Input id="handle" defaultValue="@cherry" className="col-span-2 h-8" />
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}

export const Placements: Story = {
  render: () => (
    <div className="grid grid-cols-2 gap-4">
      {(['top', 'bottom', 'left', 'right'] as const).map((side) => (
        <Popover key={side}>
          <PopoverTrigger asChild>
            <Button variant="outline" className="w-36">
              {side}
            </Button>
          </PopoverTrigger>
          <PopoverContent side={side} className="w-40">
            <p className="text-sm">Popover on {side}</p>
          </PopoverContent>
        </Popover>
      ))}
    </div>
  )
}

export const WithAnchor: Story = {
  render: () => (
    <Popover defaultOpen>
      <PopoverAnchor asChild>
        <div className="flex h-20 w-60 items-center justify-center rounded-md border border-dashed text-xs text-muted-foreground">
          Anchor area
        </div>
      </PopoverAnchor>
      <PopoverTrigger asChild>
        <Button variant="outline" className="mt-3">
          Trigger (detached)
        </Button>
      </PopoverTrigger>
      <PopoverContent side="bottom">Anchored to the dashed box above.</PopoverContent>
    </Popover>
  )
}

export const CompactMenu: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'Compact action menu pattern (DESIGN.md › Popover › Compact menu popovers). Width follows content via `w-fit` with a 128px floor (`min-w-32`) — short labels stay tight, long labels grow naturally. Compose with `MenuList` + `MenuItem`.'
      }
    }
  },
  render: () => (
    <div className="flex items-start gap-8">
      <Popover defaultOpen>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm">
            Filter
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-fit min-w-32 rounded-xl p-1.5">
          <MenuList className="gap-1">
            <MenuItem
              label="Only enabled"
              className="h-8 rounded-lg px-2.5 text-sm"
              icon={<Check className="size-3.5" />}
            />
            <MenuItem
              label="Only disabled"
              className="h-8 rounded-lg px-2.5 text-sm"
              icon={<Check className="size-3.5 opacity-0" />}
            />
            <MenuItem
              label="All providers"
              className="h-8 rounded-lg px-2.5 text-sm"
              icon={<Check className="size-3.5 opacity-0" />}
            />
            <MenuItem
              label="Agent-capable"
              className="h-8 rounded-lg px-2.5 text-sm"
              icon={<Check className="size-3.5 opacity-0" />}
            />
          </MenuList>
        </PopoverContent>
      </Popover>

      <Popover defaultOpen>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm">
            More actions
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-fit min-w-32 rounded-xl p-1.5">
          <MenuList className="gap-1">
            <MenuItem label="Edit" className="h-8 rounded-lg px-2.5 text-sm" icon={<Edit size={14} />} />
            <MenuItem label="Duplicate" className="h-8 rounded-lg px-2.5 text-sm" icon={<CopyPlus size={14} />} />
            <MenuItem label="Model notes" className="h-8 rounded-lg px-2.5 text-sm" icon={<UserPen size={14} />} />
            <MenuItem
              label="Delete"
              className="h-8 rounded-lg px-2.5 text-sm text-(--color-destructive)"
              icon={<Trash2 size={14} />}
            />
          </MenuList>
        </PopoverContent>
      </Popover>
    </div>
  )
}
