import type { Meta, StoryObj } from '@storybook/react'
import { Globe, Palette, User } from 'lucide-react'
import { useState } from 'react'

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue
} from '../../../src/components/primitives/select'

const meta: Meta<typeof Select> = {
  title: 'Components/Primitives/Select',
  component: Select,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: 'A dropdown select component based on Radix UI, with support for groups, separators, and custom content.'
      }
    }
  },
  tags: ['autodocs'],
  argTypes: {
    disabled: {
      control: { type: 'boolean' },
      description: 'Whether the select is disabled'
    },
    defaultValue: {
      control: { type: 'text' },
      description: 'Default selected value'
    },
    value: {
      control: { type: 'text' },
      description: 'Value in controlled mode'
    }
  }
}

export default meta
type Story = StoryObj<typeof meta>

// Default
export const Default: Story = {
  render: () => (
    <Select>
      <SelectTrigger>
        <SelectValue placeholder="Select an option" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="option1">Option 1</SelectItem>
        <SelectItem value="option2">Option 2</SelectItem>
        <SelectItem value="option3">Option 3</SelectItem>
        <SelectItem value="option4">Option 4</SelectItem>
      </SelectContent>
    </Select>
  )
}

// With Default Value
export const WithDefaultValue: Story = {
  render: () => (
    <Select defaultValue="option2">
      <SelectTrigger>
        <SelectValue placeholder="Select an option" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="option1">Option 1</SelectItem>
        <SelectItem value="option2">Option 2</SelectItem>
        <SelectItem value="option3">Option 3</SelectItem>
        <SelectItem value="option4">Option 4</SelectItem>
      </SelectContent>
    </Select>
  )
}

// With Icons
export const WithIcons: Story = {
  render: () => (
    <Select defaultValue="user">
      <SelectTrigger>
        <SelectValue placeholder="Select a feature" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="user">
          <User className="size-4" />
          User Management
        </SelectItem>
        <SelectItem value="theme">
          <Palette className="size-4" />
          Theme Settings
        </SelectItem>
        <SelectItem value="language">
          <Globe className="size-4" />
          Language
        </SelectItem>
      </SelectContent>
    </Select>
  )
}

// With Groups
export const WithGroups: Story = {
  render: () => (
    <Select>
      <SelectTrigger className="w-[280px]">
        <SelectValue placeholder="Select a fruit or vegetable" />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectLabel>Fruits</SelectLabel>
          <SelectItem value="apple">Apple</SelectItem>
          <SelectItem value="banana">Banana</SelectItem>
          <SelectItem value="orange">Orange</SelectItem>
        </SelectGroup>
        <SelectSeparator />
        <SelectGroup>
          <SelectLabel>Vegetables</SelectLabel>
          <SelectItem value="carrot">Carrot</SelectItem>
          <SelectItem value="potato">Potato</SelectItem>
          <SelectItem value="tomato">Tomato</SelectItem>
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}

// Sizes
export const Sizes: Story = {
  render: () => (
    <div className="flex flex-col gap-4">
      <div>
        <p className="mb-2 text-sm text-muted-foreground">Small</p>
        <Select defaultValue="option1">
          <SelectTrigger size="sm">
            <SelectValue placeholder="Small size" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="option1">Option 1</SelectItem>
            <SelectItem value="option2">Option 2</SelectItem>
            <SelectItem value="option3">Option 3</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div>
        <p className="mb-2 text-sm text-muted-foreground">Default</p>
        <Select defaultValue="option1">
          <SelectTrigger size="default">
            <SelectValue placeholder="Default size" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="option1">Option 1</SelectItem>
            <SelectItem value="option2">Option 2</SelectItem>
            <SelectItem value="option3">Option 3</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}

// Disabled
export const Disabled: Story = {
  render: () => (
    <Select disabled defaultValue="option1">
      <SelectTrigger>
        <SelectValue placeholder="Disabled select" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="option1">Option 1</SelectItem>
        <SelectItem value="option2">Option 2</SelectItem>
        <SelectItem value="option3">Option 3</SelectItem>
      </SelectContent>
    </Select>
  )
}

// Disabled Items
export const DisabledItems: Story = {
  render: () => (
    <Select>
      <SelectTrigger>
        <SelectValue placeholder="Some options disabled" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="option1">Option 1</SelectItem>
        <SelectItem value="option2" disabled>
          Option 2 (Disabled)
        </SelectItem>
        <SelectItem value="option3">Option 3</SelectItem>
        <SelectItem value="option4" disabled>
          Option 4 (Disabled)
        </SelectItem>
      </SelectContent>
    </Select>
  )
}

// Controlled
export const Controlled: Story = {
  render: function ControlledExample() {
    const [value, setValue] = useState('option1')

    return (
      <div className="flex flex-col gap-4">
        <Select value={value} onValueChange={setValue}>
          <SelectTrigger className="w-[280px]">
            <SelectValue placeholder="Select an option" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="option1">Option 1</SelectItem>
            <SelectItem value="option2">Option 2</SelectItem>
            <SelectItem value="option3">Option 3</SelectItem>
            <SelectItem value="option4">Option 4</SelectItem>
          </SelectContent>
        </Select>
        <div className="text-sm text-muted-foreground">Current value: {value}</div>
      </div>
    )
  }
}

// All States
export const AllStates: Story = {
  render: function AllStatesExample() {
    const [normalValue, setNormalValue] = useState('')
    const [selectedValue, setSelectedValue] = useState('option2')

    return (
      <div className="flex flex-col gap-6">
        {/* Normal State */}
        <div>
          <p className="mb-2 text-sm text-muted-foreground">Normal State</p>
          <Select value={normalValue} onValueChange={setNormalValue}>
            <SelectTrigger className="w-[280px]">
              <SelectValue placeholder="Please select" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="option1">Option 1</SelectItem>
              <SelectItem value="option2">Option 2</SelectItem>
              <SelectItem value="option3">Option 3</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Selected State */}
        <div>
          <p className="mb-2 text-sm text-muted-foreground">Selected State</p>
          <Select value={selectedValue} onValueChange={setSelectedValue}>
            <SelectTrigger className="w-[280px]">
              <SelectValue placeholder="Please select" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="option1">Option 1</SelectItem>
              <SelectItem value="option2">Option 2</SelectItem>
              <SelectItem value="option3">Option 3</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Disabled State */}
        <div>
          <p className="mb-2 text-sm text-muted-foreground">Disabled State</p>
          <Select disabled value={selectedValue}>
            <SelectTrigger className="w-[280px]">
              <SelectValue placeholder="Please select" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="option1">Option 1</SelectItem>
              <SelectItem value="option2">Option 2</SelectItem>
              <SelectItem value="option3">Option 3</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Error State */}
        <div>
          <p className="mb-2 text-sm text-muted-foreground">Error State</p>
          <Select value="">
            <SelectTrigger className="w-[280px]" aria-invalid>
              <SelectValue placeholder="This field is required" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="option1">Option 1</SelectItem>
              <SelectItem value="option2">Option 2</SelectItem>
              <SelectItem value="option3">Option 3</SelectItem>
            </SelectContent>
          </Select>
          <p className="mt-1 text-xs text-destructive">Please select an option</p>
        </div>
      </div>
    )
  }
}

// Real World Examples
export const RealWorldExamples: Story = {
  render: function RealWorldExample() {
    const [language, setLanguage] = useState('zh-CN')
    const [theme, setTheme] = useState('system')
    const [timezone, setTimezone] = useState('')

    return (
      <div className="flex flex-col gap-8">
        {/* Language Selection */}
        <div>
          <h3 className="mb-3 text-sm font-semibold">Language Settings</h3>
          <Select value={language} onValueChange={setLanguage}>
            <SelectTrigger className="w-[280px]">
              <SelectValue placeholder="Select language" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="zh-CN">
                <Globe className="size-4" />
                Simplified Chinese
              </SelectItem>
              <SelectItem value="zh-TW">
                <Globe className="size-4" />
                Traditional Chinese
              </SelectItem>
              <SelectItem value="en-US">
                <Globe className="size-4" />
                English
              </SelectItem>
              <SelectItem value="ja-JP">
                <Globe className="size-4" />
                Japanese
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Theme Selection */}
        <div>
          <h3 className="mb-3 text-sm font-semibold">Theme Settings</h3>
          <Select value={theme} onValueChange={setTheme}>
            <SelectTrigger className="w-[280px]">
              <SelectValue placeholder="Select theme" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="light">
                <Palette className="size-4" />
                Light
              </SelectItem>
              <SelectItem value="dark">
                <Palette className="size-4" />
                Dark
              </SelectItem>
              <SelectItem value="system">
                <Palette className="size-4" />
                System
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Timezone Selection (with groups) */}
        <div>
          <h3 className="mb-3 text-sm font-semibold">Timezone Settings</h3>
          <Select value={timezone} onValueChange={setTimezone}>
            <SelectTrigger className="w-[280px]">
              <SelectValue placeholder="Select timezone" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectLabel>Asia</SelectLabel>
                <SelectItem value="Asia/Shanghai">Shanghai (UTC+8)</SelectItem>
                <SelectItem value="Asia/Tokyo">Tokyo (UTC+9)</SelectItem>
                <SelectItem value="Asia/Seoul">Seoul (UTC+9)</SelectItem>
              </SelectGroup>
              <SelectSeparator />
              <SelectGroup>
                <SelectLabel>America</SelectLabel>
                <SelectItem value="America/New_York">New York (UTC-5)</SelectItem>
                <SelectItem value="America/Los_Angeles">Los Angeles (UTC-8)</SelectItem>
                <SelectItem value="America/Chicago">Chicago (UTC-6)</SelectItem>
              </SelectGroup>
              <SelectSeparator />
              <SelectGroup>
                <SelectLabel>Europe</SelectLabel>
                <SelectItem value="Europe/London">London (UTC+0)</SelectItem>
                <SelectItem value="Europe/Paris">Paris (UTC+1)</SelectItem>
                <SelectItem value="Europe/Berlin">Berlin (UTC+1)</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>

        {/* Required Field Example */}
        <div>
          <h3 className="mb-3 text-sm font-semibold">User Role (Required)</h3>
          <Select value="">
            <SelectTrigger className="w-[280px]" aria-invalid>
              <SelectValue placeholder="Select user role" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="admin">
                <User className="size-4" />
                Administrator
              </SelectItem>
              <SelectItem value="editor">
                <User className="size-4" />
                Editor
              </SelectItem>
              <SelectItem value="viewer">
                <User className="size-4" />
                Viewer
              </SelectItem>
            </SelectContent>
          </Select>
          <p className="mt-1 text-xs text-destructive">Please select a user role</p>
        </div>
      </div>
    )
  }
}

// Long List
export const LongList: Story = {
  render: () => (
    <Select>
      <SelectTrigger className="w-[280px]">
        <SelectValue placeholder="Select a number" />
      </SelectTrigger>
      <SelectContent>
        {Array.from({ length: 50 }, (_, i) => (
          <SelectItem key={i + 1} value={`item-${i + 1}`}>
            Option {i + 1}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
