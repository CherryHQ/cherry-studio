import type { Meta, StoryObj } from '@storybook/react-vite'
import {
  Brain,
  Cloud,
  Command,
  FileCode,
  HardDrive,
  Info,
  MessageSquare,
  MonitorCog,
  Package,
  Palette,
  Search,
  Settings2,
  Sparkles,
  Zap
} from 'lucide-react'
import { useState } from 'react'

import { MenuDivider, MenuItem, MenuList } from '../../../src/components'

const meta: Meta<typeof MenuItem> = {
  title: 'Components/Composites/menu-list',
  component: MenuItem,
  parameters: {
    layout: 'centered'
  },
  tags: ['autodocs']
}

export default meta
type Story = StoryObj<typeof meta>

// ---------------------------------------------------------------------------
// Basic MenuItem
// ---------------------------------------------------------------------------

export const Default: Story = {
  args: {
    icon: <Settings2 size={16} />,
    label: 'General Settings',
    active: false
  }
}

export const Active: Story = {
  args: {
    icon: <Settings2 size={16} />,
    label: 'General Settings',
    active: true
  }
}

export const GhostVariant: Story = {
  args: {
    icon: <MessageSquare size={16} strokeWidth={1.6} />,
    label: 'Chat',
    active: true,
    variant: 'ghost'
  }
}

export const SmallSize: Story = {
  args: {
    icon: <Search size={13} />,
    label: 'Web Search',
    size: 'sm'
  }
}

export const WithSuffix: Story = {
  args: {
    icon: <Package size={16} />,
    label: 'Plugins',
    suffix: <span className="rounded-md bg-accent px-1.5 py-0.5 text-[10px] text-foreground-muted">12</span>
  }
}

export const Disabled: Story = {
  args: {
    icon: <Sparkles size={16} />,
    label: 'Coming Soon',
    disabled: true
  }
}

export const WithDescription: Story = {
  args: {
    icon: <Settings2 size={16} />,
    label: 'General Settings',
    description: 'App-wide preferences and behavior'
  }
}

// `descriptionClassName` lets consumers override the default description style
// (`text-[10px] text-muted-foreground mt-0.5`). tailwind-merge handles conflicts;
// `group-data-[active=true]:` selectors work because the root carries `group`.
export const CustomDescriptionStyle: Story = {
  args: {
    icon: <Settings2 size={16} strokeWidth={1.6} />,
    label: 'General Settings',
    description: 'Smaller, dimmer description text that brightens when the item is active',
    descriptionClassName: 'mt-px text-[9px] text-muted-foreground/45 group-data-[active=true]:text-muted-foreground/70',
    active: true
  }
}

// `labelClassName` lets consumers style the label text directly — for example
// boosting font-weight on the active row. Use `group-data-[active=true]:` (the
// root carries `group` + `data-active`) instead of relying on CSS inheritance.
export const CustomLabelStyle: Story = {
  args: {
    icon: <Cloud size={16} />,
    label: 'Model Provider',
    labelClassName: 'group-data-[active=true]:font-medium',
    active: true
  }
}

// ---------------------------------------------------------------------------
// Settings Menu — default variant with border active
// ---------------------------------------------------------------------------

function SettingsMenuExample() {
  const [active, setActive] = useState('provider')

  const items = [
    { id: 'provider', icon: Cloud, label: 'Model Provider' },
    { id: 'model', icon: Package, label: 'Default Model' },
    { id: 'divider-1', divider: true },
    { id: 'general', icon: Settings2, label: 'General' },
    { id: 'display', icon: MonitorCog, label: 'Display' },
    { id: 'data', icon: HardDrive, label: 'Data' },
    { id: 'divider-2', divider: true },
    { id: 'websearch', icon: Search, label: 'Web Search' },
    { id: 'memory', icon: Brain, label: 'Memory' },
    { id: 'docprocess', icon: FileCode, label: 'Documents' },
    { id: 'quickphrase', icon: Zap, label: 'Quick Phrases' },
    { id: 'shortcut', icon: Command, label: 'Shortcuts' },
    { id: 'divider-3', divider: true },
    { id: 'about', icon: Info, label: 'About' }
  ] as const

  return (
    <div className="w-[200px] rounded-xl border border-border bg-background p-2">
      <MenuList>
        {items.map((item) =>
          'divider' in item ? (
            <MenuDivider key={item.id} />
          ) : (
            <MenuItem
              key={item.id}
              icon={<item.icon size={16} />}
              label={item.label}
              active={active === item.id}
              onClick={() => setActive(item.id)}
            />
          )
        )}
      </MenuList>
    </div>
  )
}

export const SettingsMenu: StoryObj = {
  render: () => <SettingsMenuExample />
}

// ---------------------------------------------------------------------------
// Sidebar Full Menu — ghost variant (no border on active)
// ---------------------------------------------------------------------------

function SidebarFullMenuExample() {
  const [active, setActive] = useState('chat')

  const items = [
    { id: 'chat', icon: MessageSquare, label: 'Chat' },
    { id: 'agent', icon: Sparkles, label: 'Agent' },
    { id: 'painting', icon: Palette, label: 'Painting' },
    { id: 'search', icon: Search, label: 'Explore' },
    { id: 'knowledge', icon: Brain, label: 'Knowledge' }
  ]

  return (
    <div className="w-[170px] rounded-xl bg-background p-2">
      <MenuList>
        {items.map((item) => (
          <MenuItem
            key={item.id}
            variant="ghost"
            icon={<item.icon size={16} strokeWidth={1.6} />}
            label={item.label}
            active={active === item.id}
            onClick={() => setActive(item.id)}
          />
        ))}
      </MenuList>
    </div>
  )
}

export const SidebarFullMenu: StoryObj = {
  render: () => <SidebarFullMenuExample />
}

// ---------------------------------------------------------------------------
// Design Reference — sm size with groups (preview of Phase 2 pattern)
// ---------------------------------------------------------------------------

function SmallMenuWithGroupsExample() {
  const [active, setActive] = useState('models')

  const groups = [
    {
      label: 'Integration',
      items: [
        { id: 'models', icon: Cloud, label: 'Model Service' },
        { id: 'default-model', icon: Sparkles, label: 'Default Model' }
      ]
    },
    {
      label: 'Services',
      items: [
        { id: 'search', icon: Search, label: 'Web Search' },
        { id: 'memory', icon: Brain, label: 'Memory' }
      ]
    },
    {
      label: 'System',
      items: [
        { id: 'general', icon: Settings2, label: 'General' },
        { id: 'about', icon: Info, label: 'About' }
      ]
    }
  ]

  return (
    <div className="w-[180px] rounded-xl border border-border bg-background px-2 py-3">
      <MenuList className="gap-1">
        {groups.map((group, gi) => (
          <div key={gi}>
            <p className="px-3 pt-2 pb-1 text-[9px] leading-3 text-foreground-muted">{group.label}</p>
            <div className="space-y-px">
              {group.items.map((item) => (
                <MenuItem
                  key={item.id}
                  size="sm"
                  icon={<item.icon size={13} />}
                  label={item.label}
                  active={active === item.id}
                  onClick={() => setActive(item.id)}
                />
              ))}
            </div>
          </div>
        ))}
      </MenuList>
    </div>
  )
}

export const SmallMenuWithGroups: StoryObj = {
  render: () => <SmallMenuWithGroupsExample />
}

// ---------------------------------------------------------------------------
// Settings submenu pattern — project-level className tokens + labelClassName
// ---------------------------------------------------------------------------

function SettingsSubmenuActiveBoldExample() {
  const [active, setActive] = useState('provider')

  // Mirrors `settings/index.tsx` tokens. Keeps the project-level override
  // (h-8 + rounded-[10px] + hover/active surface) on `className`, and isolates
  // the state-driven label weight onto `labelClassName`.
  const itemClassName =
    'h-8 rounded-[10px] border-transparent px-2.5 font-normal text-foreground/85 text-sm hover:!bg-muted data-[active=true]:!border-transparent data-[active=true]:!bg-muted data-[active=true]:!text-foreground [&_svg]:size-4 [&_svg]:text-foreground/70'
  const itemLabelClassName = 'group-data-[active=true]:font-medium'
  const sectionTitleClassName = 'px-2.5 pt-1.5 pb-1 font-normal text-foreground-muted text-xs first:pt-0'
  const dividerClassName = 'my-1 bg-transparent'

  const groups = [
    {
      label: 'Integration',
      items: [
        { id: 'provider', icon: Cloud, label: 'Model Provider' },
        { id: 'model', icon: Package, label: 'Default Model' }
      ]
    },
    {
      label: 'App Settings',
      items: [
        { id: 'general', icon: Settings2, label: 'General' },
        { id: 'data', icon: HardDrive, label: 'Data' }
      ]
    }
  ] as const

  return (
    <div className="w-[200px] rounded-xl border border-border bg-background py-2.5">
      <MenuList className="flex flex-col gap-1 px-2.5">
        {groups.map((group, gi) => (
          <div key={group.label}>
            {gi > 0 && <MenuDivider className={dividerClassName} />}
            <div className={sectionTitleClassName}>{group.label}</div>
            {group.items.map((item) => (
              <MenuItem
                key={item.id}
                className={itemClassName}
                labelClassName={itemLabelClassName}
                icon={<item.icon />}
                label={item.label}
                active={active === item.id}
                onClick={() => setActive(item.id)}
              />
            ))}
          </div>
        ))}
      </MenuList>
    </div>
  )
}

export const SettingsSubmenuActiveBold: StoryObj = {
  parameters: {
    docs: {
      description: {
        story:
          'Real settings page pattern — combine a project-level `className` token (height / hover / active surface) with `labelClassName="group-data-[active=true]:font-medium"` to bold the active row label. Prefer this over `[font-weight:inherit]` style hacks so the rule is visible in the inspector and the rendered DOM matches the source.'
      }
    }
  },
  render: () => <SettingsSubmenuActiveBoldExample />
}
