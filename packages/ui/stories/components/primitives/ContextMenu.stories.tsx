import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuItemContent,
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
import { Cloud, Copy, Edit, Folder, Mail, Settings, Trash2, User } from 'lucide-react'
import * as React from 'react'

const meta: Meta<typeof ContextMenu> = {
  title: 'Components/Primitives/ContextMenu',
  component: ContextMenu,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'A context menu component that displays a menu of actions when the user right-clicks. Based on Radix UI Context Menu primitive, styled to match the Cherry Studio design system.'
      }
    }
  },
  tags: ['autodocs']
}

export default meta
type Story = StoryObj<typeof meta>

// Default
export const Default: Story = {
  render: () => (
    <ContextMenu>
      <ContextMenuTrigger className="flex h-[150px] w-[300px] items-center justify-center rounded-md border border-dashed text-sm">
        Right click here
      </ContextMenuTrigger>
      <ContextMenuContent className="w-64">
        <ContextMenuItem>
          <ContextMenuItemContent icon={<Edit className="size-4" />}>Edit</ContextMenuItemContent>
        </ContextMenuItem>
        <ContextMenuItem>
          <ContextMenuItemContent icon={<Copy className="size-4" />} shortcut="⌘C">
            Copy
          </ContextMenuItemContent>
        </ContextMenuItem>
        <ContextMenuItem>
          <ContextMenuItemContent icon={<Folder className="size-4" />}>Move to Folder</ContextMenuItemContent>
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem variant="destructive">
          <ContextMenuItemContent icon={<Trash2 className="size-4" />}>Delete</ContextMenuItemContent>
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

// With Shortcuts
export const WithShortcuts: Story = {
  render: () => (
    <ContextMenu>
      <ContextMenuTrigger className="flex h-[150px] w-[300px] items-center justify-center rounded-md border border-dashed text-sm">
        Right click here
      </ContextMenuTrigger>
      <ContextMenuContent className="w-64">
        <ContextMenuItem>
          <span>Cut</span>
          <ContextMenuShortcut>⌘X</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem>
          <span>Copy</span>
          <ContextMenuShortcut>⌘C</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem>
          <span>Paste</span>
          <ContextMenuShortcut>⌘V</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem>
          <span>Select All</span>
          <ContextMenuShortcut>⌘A</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem>
          <span>Find</span>
          <ContextMenuShortcut>⌘F</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem>
          <span>Replace</span>
          <ContextMenuShortcut>⌘⇧H</ContextMenuShortcut>
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

// With Submenu
export const WithSubmenu: Story = {
  render: () => (
    <ContextMenu>
      <ContextMenuTrigger className="flex h-[150px] w-[300px] items-center justify-center rounded-md border border-dashed text-sm">
        Right click here
      </ContextMenuTrigger>
      <ContextMenuContent className="w-64">
        <ContextMenuItem>
          <ContextMenuItemContent icon={<Edit className="size-4" />}>Edit</ContextMenuItemContent>
        </ContextMenuItem>
        <ContextMenuItem>
          <ContextMenuItemContent icon={<Copy className="size-4" />}>Duplicate</ContextMenuItemContent>
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <Folder className="size-4" />
            Move to Folder
          </ContextMenuSubTrigger>
          <ContextMenuSubContent className="w-48">
            <ContextMenuItem>Documents</ContextMenuItem>
            <ContextMenuItem>Downloads</ContextMenuItem>
            <ContextMenuItem>Desktop</ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem>New Folder...</ContextMenuItem>
          </ContextMenuSubContent>
        </ContextMenuSub>
        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <User className="size-4" />
            Share with
          </ContextMenuSubTrigger>
          <ContextMenuSubContent className="w-48">
            <ContextMenuItem>
              <Mail className="size-4" />
              Email
            </ContextMenuItem>
            <ContextMenuItem>
              <Cloud className="size-4" />
              Cloud Link
            </ContextMenuItem>
          </ContextMenuSubContent>
        </ContextMenuSub>
        <ContextMenuSeparator />
        <ContextMenuItem variant="destructive">
          <ContextMenuItemContent icon={<Trash2 className="size-4" />}>Delete</ContextMenuItemContent>
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

// With Checkbox Items
export const WithCheckboxItems: Story = {
  render: function Render() {
    const [showStatusBar, setShowStatusBar] = React.useState(true)
    const [showActivityBar, setShowActivityBar] = React.useState(false)
    const [showPanel, setShowPanel] = React.useState(false)

    return (
      <ContextMenu>
        <ContextMenuTrigger className="flex h-[150px] w-[300px] items-center justify-center rounded-md border border-dashed text-sm">
          Right click here
        </ContextMenuTrigger>
        <ContextMenuContent className="w-64">
          <ContextMenuLabel>View Options</ContextMenuLabel>
          <ContextMenuSeparator />
          <ContextMenuCheckboxItem checked={showStatusBar} onCheckedChange={setShowStatusBar}>
            Show Status Bar
          </ContextMenuCheckboxItem>
          <ContextMenuCheckboxItem checked={showActivityBar} onCheckedChange={setShowActivityBar}>
            Show Activity Bar
          </ContextMenuCheckboxItem>
          <ContextMenuCheckboxItem checked={showPanel} onCheckedChange={setShowPanel}>
            Show Panel
          </ContextMenuCheckboxItem>
        </ContextMenuContent>
      </ContextMenu>
    )
  }
}

// With Radio Items
export const WithRadioItems: Story = {
  render: function Render() {
    const [theme, setTheme] = React.useState('system')

    return (
      <ContextMenu>
        <ContextMenuTrigger className="flex h-[150px] w-[300px] items-center justify-center rounded-md border border-dashed text-sm">
          Right click here
        </ContextMenuTrigger>
        <ContextMenuContent className="w-64">
          <ContextMenuLabel>Theme</ContextMenuLabel>
          <ContextMenuSeparator />
          <ContextMenuRadioGroup value={theme} onValueChange={setTheme}>
            <ContextMenuRadioItem value="light">Light</ContextMenuRadioItem>
            <ContextMenuRadioItem value="dark">Dark</ContextMenuRadioItem>
            <ContextMenuRadioItem value="system">System</ContextMenuRadioItem>
          </ContextMenuRadioGroup>
        </ContextMenuContent>
      </ContextMenu>
    )
  }
}

// With Groups and Labels
export const WithGroupsAndLabels: Story = {
  render: () => (
    <ContextMenu>
      <ContextMenuTrigger className="flex h-[150px] w-[300px] items-center justify-center rounded-md border border-dashed text-sm">
        Right click here
      </ContextMenuTrigger>
      <ContextMenuContent className="w-64">
        <ContextMenuLabel>Edit</ContextMenuLabel>
        <ContextMenuGroup>
          <ContextMenuItem>
            <span>Cut</span>
            <ContextMenuShortcut>⌘X</ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuItem>
            <span>Copy</span>
            <ContextMenuShortcut>⌘C</ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuItem>
            <span>Paste</span>
            <ContextMenuShortcut>⌘V</ContextMenuShortcut>
          </ContextMenuItem>
        </ContextMenuGroup>
        <ContextMenuSeparator />
        <ContextMenuLabel>View</ContextMenuLabel>
        <ContextMenuGroup>
          <ContextMenuItem>Zoom In</ContextMenuItem>
          <ContextMenuItem>Zoom Out</ContextMenuItem>
          <ContextMenuItem>Reset Zoom</ContextMenuItem>
        </ContextMenuGroup>
        <ContextMenuSeparator />
        <ContextMenuLabel>Danger Zone</ContextMenuLabel>
        <ContextMenuGroup>
          <ContextMenuItem variant="destructive">
            <ContextMenuItemContent icon={<Trash2 className="size-4" />}>Delete</ContextMenuItemContent>
          </ContextMenuItem>
        </ContextMenuGroup>
      </ContextMenuContent>
    </ContextMenu>
  )
}

// Disabled Items
export const DisabledItems: Story = {
  render: () => (
    <ContextMenu>
      <ContextMenuTrigger className="flex h-[150px] w-[300px] items-center justify-center rounded-md border border-dashed text-sm">
        Right click here
      </ContextMenuTrigger>
      <ContextMenuContent className="w-64">
        <ContextMenuItem>
          <ContextMenuItemContent icon={<Edit className="size-4" />}>Edit</ContextMenuItemContent>
        </ContextMenuItem>
        <ContextMenuItem disabled>
          <ContextMenuItemContent icon={<Copy className="size-4" />}>Copy (Disabled)</ContextMenuItemContent>
        </ContextMenuItem>
        <ContextMenuItem>
          <ContextMenuItemContent icon={<Folder className="size-4" />}>Move</ContextMenuItemContent>
        </ContextMenuItem>
        <ContextMenuItem disabled>
          <ContextMenuItemContent icon={<Trash2 className="size-4" />}>Delete (Disabled)</ContextMenuItemContent>
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

// Complex Example
export const ComplexExample: Story = {
  render: function Render() {
    const [bookmarked, setBookmarked] = React.useState(false)
    const [pinned, setPinned] = React.useState(true)
    const [sortBy, setSortBy] = React.useState('date')

    return (
      <ContextMenu>
        <ContextMenuTrigger className="flex h-[200px] w-[350px] items-center justify-center rounded-md border border-dashed text-sm">
          Right click for full menu
        </ContextMenuTrigger>
        <ContextMenuContent className="w-72">
          <ContextMenuItem>
            <ContextMenuItemContent icon={<Edit className="size-4" />} shortcut="⌘E">
              Edit
            </ContextMenuItemContent>
          </ContextMenuItem>
          <ContextMenuItem>
            <ContextMenuItemContent icon={<Copy className="size-4" />} shortcut="⌘D">
              Duplicate
            </ContextMenuItemContent>
          </ContextMenuItem>

          <ContextMenuSeparator />

          <ContextMenuCheckboxItem checked={bookmarked} onCheckedChange={setBookmarked}>
            Add to Bookmarks
          </ContextMenuCheckboxItem>
          <ContextMenuCheckboxItem checked={pinned} onCheckedChange={setPinned}>
            Pin to Top
          </ContextMenuCheckboxItem>

          <ContextMenuSeparator />

          <ContextMenuSub>
            <ContextMenuSubTrigger>
              <Folder className="size-4" />
              Move to
            </ContextMenuSubTrigger>
            <ContextMenuSubContent className="w-48">
              <ContextMenuItem>Inbox</ContextMenuItem>
              <ContextMenuItem>Work</ContextMenuItem>
              <ContextMenuItem>Personal</ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem>Create New Folder...</ContextMenuItem>
            </ContextMenuSubContent>
          </ContextMenuSub>

          <ContextMenuSub>
            <ContextMenuSubTrigger>
              <User className="size-4" />
              Share
            </ContextMenuSubTrigger>
            <ContextMenuSubContent className="w-48">
              <ContextMenuItem>
                <Mail className="size-4" />
                Email
              </ContextMenuItem>
              <ContextMenuItem>
                <Cloud className="size-4" />
                Copy Link
              </ContextMenuItem>
            </ContextMenuSubContent>
          </ContextMenuSub>

          <ContextMenuSeparator />

          <ContextMenuLabel>Sort By</ContextMenuLabel>
          <ContextMenuRadioGroup value={sortBy} onValueChange={setSortBy}>
            <ContextMenuRadioItem value="date">Date Modified</ContextMenuRadioItem>
            <ContextMenuRadioItem value="name">Name</ContextMenuRadioItem>
            <ContextMenuRadioItem value="size">Size</ContextMenuRadioItem>
          </ContextMenuRadioGroup>

          <ContextMenuSeparator />

          <ContextMenuItem variant="destructive">
            <ContextMenuItemContent icon={<Trash2 className="size-4" />} shortcut="⌘⌫">
              Delete
            </ContextMenuItemContent>
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    )
  }
}

// Inset Items
export const InsetItems: Story = {
  render: () => (
    <ContextMenu>
      <ContextMenuTrigger className="flex h-[150px] w-[300px] items-center justify-center rounded-md border border-dashed text-sm">
        Right click here
      </ContextMenuTrigger>
      <ContextMenuContent className="w-64">
        <ContextMenuItem inset>Inset Item 1</ContextMenuItem>
        <ContextMenuItem inset>Inset Item 2</ContextMenuItem>
        <ContextMenuItem inset>Inset Item 3</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuLabel inset>Inset Label</ContextMenuLabel>
        <ContextMenuItem inset>Inset Item 4</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

// Figma Design - Assistant Menu
export const FigmaAssistantMenu: Story = {
  render: () => (
    <ContextMenu>
      <ContextMenuTrigger className="flex h-[150px] w-[300px] items-center justify-center rounded-md border border-dashed text-sm">
        Right click here (Figma Design)
      </ContextMenuTrigger>
      <ContextMenuContent className="w-56">
        <ContextMenuItem>
          <Edit className="size-4" />
          <span>Edit Assistant</span>
        </ContextMenuItem>
        <ContextMenuItem>
          <Copy className="size-4" />
          <span>Copy Assistant</span>
        </ContextMenuItem>
        <ContextMenuItem>
          <Trash2 className="size-4" />
          <span>Clear topics</span>
        </ContextMenuItem>
        <ContextMenuItem>
          <Folder className="size-4" />
          <span>Save to assistant library</span>
        </ContextMenuItem>
        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <User className="size-4" />
            Assistant Icon
          </ContextMenuSubTrigger>
          <ContextMenuSubContent>
            <ContextMenuItem>🍒 Cherry</ContextMenuItem>
            <ContextMenuItem>🤖 Robot</ContextMenuItem>
            <ContextMenuItem>✨ Star</ContextMenuItem>
          </ContextMenuSubContent>
        </ContextMenuSub>
        <ContextMenuSeparator />
        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <Settings className="size-4" />
            Tag Management
          </ContextMenuSubTrigger>
          <ContextMenuSubContent>
            <ContextMenuItem>Add Tag</ContextMenuItem>
            <ContextMenuItem>Remove Tag</ContextMenuItem>
          </ContextMenuSubContent>
        </ContextMenuSub>
        <ContextMenuItem>
          <Mail className="size-4" />
          <span>List View</span>
        </ContextMenuItem>
        <ContextMenuItem>
          <Cloud className="size-4" />
          <span>Sort by Pinyin (A-Z)</span>
        </ContextMenuItem>
        <ContextMenuItem>
          <Cloud className="size-4" />
          <span>Sort by Pinyin (Z-A)</span>
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem variant="destructive">
          <Trash2 className="size-4" />
          <span>Delete</span>
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
