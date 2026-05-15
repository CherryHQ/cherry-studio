import {
  Badge,
  Button,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemFooter,
  ItemGroup,
  ItemHeader,
  ItemMedia,
  ItemSeparator,
  ItemTitle
} from '@cherrystudio/ui'
import type { Meta, StoryObj } from '@storybook/react'
import { Bell, Check, ChevronRight, Cloud, Database, FileText, Settings, Shield } from 'lucide-react'

const meta: Meta<typeof Item> = {
  title: 'Components/Primitives/Item',
  component: Item,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'Displays structured list items with media, content, actions, headers, and footers. Based on shadcn/ui.'
      }
    }
  },
  tags: ['autodocs'],
  argTypes: {
    variant: {
      control: { type: 'select' },
      options: ['default', 'outline', 'muted'],
      description: 'The visual style variant of the item'
    },
    size: {
      control: { type: 'select' },
      options: ['default', 'sm'],
      description: 'The size of the item'
    },
    asChild: {
      control: { type: 'boolean' },
      description: 'Render as a child element'
    },
    className: {
      control: { type: 'text' },
      description: 'Additional CSS classes'
    }
  }
}

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: () => (
    <Item className="w-[360px]">
      <ItemMedia variant="icon">
        <Settings />
      </ItemMedia>
      <ItemContent>
        <ItemTitle>General Settings</ItemTitle>
        <ItemDescription>Configure the default behavior and appearance of the application.</ItemDescription>
      </ItemContent>
      <ItemActions>
        <Button variant="ghost" size="icon-sm" aria-label="Open settings">
          <ChevronRight />
        </Button>
      </ItemActions>
    </Item>
  )
}

export const Variants: Story = {
  render: () => (
    <div className="grid w-[420px] gap-3">
      <Item>
        <ItemMedia variant="icon">
          <FileText />
        </ItemMedia>
        <ItemContent>
          <ItemTitle>Default</ItemTitle>
          <ItemDescription>A transparent item for subtle list layouts.</ItemDescription>
        </ItemContent>
      </Item>
      <Item variant="outline">
        <ItemMedia variant="icon">
          <Database />
        </ItemMedia>
        <ItemContent>
          <ItemTitle>Outline</ItemTitle>
          <ItemDescription>A bordered item for grouped settings or selectable rows.</ItemDescription>
        </ItemContent>
      </Item>
      <Item variant="muted">
        <ItemMedia variant="icon">
          <Cloud />
        </ItemMedia>
        <ItemContent>
          <ItemTitle>Muted</ItemTitle>
          <ItemDescription>A softened item for secondary cards or inactive states.</ItemDescription>
        </ItemContent>
      </Item>
    </div>
  )
}

export const Sizes: Story = {
  render: () => (
    <div className="grid w-[420px] gap-3">
      <Item size="sm" variant="outline">
        <ItemMedia variant="icon">
          <Bell />
        </ItemMedia>
        <ItemContent>
          <ItemTitle>Small item</ItemTitle>
          <ItemDescription>Compact spacing for dense settings lists.</ItemDescription>
        </ItemContent>
      </Item>
      <Item variant="outline">
        <ItemMedia variant="icon">
          <Bell />
        </ItemMedia>
        <ItemContent>
          <ItemTitle>Default item</ItemTitle>
          <ItemDescription>Comfortable spacing for explanatory list rows.</ItemDescription>
        </ItemContent>
      </Item>
    </div>
  )
}

export const WithHeaderAndFooter: Story = {
  render: () => (
    <Item variant="outline" className="w-[420px]">
      <ItemHeader>
        <Badge variant="outline">Security</Badge>
        <span className="text-muted-foreground text-xs">Updated today</span>
      </ItemHeader>
      <ItemMedia variant="icon">
        <Shield />
      </ItemMedia>
      <ItemContent>
        <ItemTitle>Device verification</ItemTitle>
        <ItemDescription>Require trusted devices before syncing sensitive data.</ItemDescription>
      </ItemContent>
      <ItemActions>
        <Button variant="outline" size="sm">
          Manage
        </Button>
      </ItemActions>
      <ItemFooter>
        <span className="text-muted-foreground text-xs">2 devices trusted</span>
        <span className="flex items-center gap-1 text-success text-xs">
          <Check size={12} />
          Enabled
        </span>
      </ItemFooter>
    </Item>
  )
}

export const GroupedSettings: Story = {
  render: () => (
    <ItemGroup className="w-[420px] rounded-lg border border-border bg-background">
      <Item size="sm">
        <ItemMedia variant="icon">
          <Cloud />
        </ItemMedia>
        <ItemContent>
          <ItemTitle>Cloud sync</ItemTitle>
          <ItemDescription>Keep settings available across devices.</ItemDescription>
        </ItemContent>
        <ItemActions>
          <Badge>On</Badge>
        </ItemActions>
      </Item>
      <ItemSeparator />
      <Item size="sm">
        <ItemMedia variant="icon">
          <Database />
        </ItemMedia>
        <ItemContent>
          <ItemTitle>Local data</ItemTitle>
          <ItemDescription>Manage caches, exports, and local backups.</ItemDescription>
        </ItemContent>
        <ItemActions>
          <Button variant="ghost" size="icon-sm" aria-label="Open local data">
            <ChevronRight />
          </Button>
        </ItemActions>
      </Item>
    </ItemGroup>
  )
}

export const AsChild: Story = {
  render: () => (
    <Item asChild variant="outline" className="w-[360px] hover:bg-accent">
      <a href="#" aria-label="Open documentation">
        <ItemMedia variant="icon">
          <FileText />
        </ItemMedia>
        <ItemContent>
          <ItemTitle>Documentation</ItemTitle>
          <ItemDescription>Use asChild to render an item as a link.</ItemDescription>
        </ItemContent>
      </a>
    </Item>
  )
}
