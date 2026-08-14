import { RadioGroup, RadioGroupItem } from '@cherrystudio/ui'
import type { Meta, StoryObj } from '@storybook/react'
import { Bell, Check, Moon, Palette, Sun } from 'lucide-react'
import { useState } from 'react'

const meta: Meta<typeof RadioGroup> = {
  title: 'Components/Primitives/RadioGroup',
  component: RadioGroup,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'A radio group component based on Radix UI, allowing users to select a single option from a set. Supports three sizes (sm, md, lg) as defined in the Figma design system.'
      }
    }
  },
  tags: ['autodocs'],
  argTypes: {
    disabled: {
      control: { type: 'boolean' },
      description: 'Whether the radio group is disabled'
    },
    defaultValue: {
      control: { type: 'text' },
      description: 'Default selected value'
    },
    value: {
      control: { type: 'text' },
      description: 'Value in controlled mode'
    },
    orientation: {
      control: { type: 'select' },
      options: ['horizontal', 'vertical'],
      description: 'The orientation of the radio group'
    }
  }
}

export default meta
type Story = StoryObj<typeof meta>

// Default
export const Default: Story = {
  render: () => (
    <RadioGroup defaultValue="option1">
      <div className="flex items-center gap-2">
        <RadioGroupItem value="option1" id="option1" />
        <label htmlFor="option1" className="cursor-pointer text-sm">
          Option 1
        </label>
      </div>
      <div className="flex items-center gap-2">
        <RadioGroupItem value="option2" id="option2" />
        <label htmlFor="option2" className="cursor-pointer text-sm">
          Option 2
        </label>
      </div>
      <div className="flex items-center gap-2">
        <RadioGroupItem value="option3" id="option3" />
        <label htmlFor="option3" className="cursor-pointer text-sm">
          Option 3
        </label>
      </div>
    </RadioGroup>
  )
}

// With Default Value
export const WithDefaultValue: Story = {
  render: () => (
    <RadioGroup defaultValue="option2">
      <div className="flex items-center gap-2">
        <RadioGroupItem value="option1" id="default-option1" />
        <label htmlFor="default-option1" className="cursor-pointer text-sm">
          Option 1
        </label>
      </div>
      <div className="flex items-center gap-2">
        <RadioGroupItem value="option2" id="default-option2" />
        <label htmlFor="default-option2" className="cursor-pointer text-sm">
          Option 2 (Default)
        </label>
      </div>
      <div className="flex items-center gap-2">
        <RadioGroupItem value="option3" id="default-option3" />
        <label htmlFor="default-option3" className="cursor-pointer text-sm">
          Option 3
        </label>
      </div>
    </RadioGroup>
  )
}

// Horizontal Layout
export const HorizontalLayout: Story = {
  render: () => (
    <RadioGroup defaultValue="option1" className="flex-row">
      <div className="flex items-center gap-2">
        <RadioGroupItem value="option1" id="h-option1" />
        <label htmlFor="h-option1" className="cursor-pointer text-sm">
          Option 1
        </label>
      </div>
      <div className="flex items-center gap-2">
        <RadioGroupItem value="option2" id="h-option2" />
        <label htmlFor="h-option2" className="cursor-pointer text-sm">
          Option 2
        </label>
      </div>
      <div className="flex items-center gap-2">
        <RadioGroupItem value="option3" id="h-option3" />
        <label htmlFor="h-option3" className="cursor-pointer text-sm">
          Option 3
        </label>
      </div>
    </RadioGroup>
  )
}

// Disabled
export const Disabled: Story = {
  render: () => (
    <RadioGroup disabled defaultValue="option1">
      <div className="flex items-center gap-2">
        <RadioGroupItem value="option1" id="disabled-option1" />
        <label htmlFor="disabled-option1" className="cursor-not-allowed text-sm opacity-50">
          Option 1 (Selected & Disabled)
        </label>
      </div>
      <div className="flex items-center gap-2">
        <RadioGroupItem value="option2" id="disabled-option2" />
        <label htmlFor="disabled-option2" className="cursor-not-allowed text-sm opacity-50">
          Option 2 (Disabled)
        </label>
      </div>
      <div className="flex items-center gap-2">
        <RadioGroupItem value="option3" id="disabled-option3" />
        <label htmlFor="disabled-option3" className="cursor-not-allowed text-sm opacity-50">
          Option 3 (Disabled)
        </label>
      </div>
    </RadioGroup>
  )
}

// Disabled Items
export const DisabledItems: Story = {
  render: () => (
    <RadioGroup defaultValue="option1">
      <div className="flex items-center gap-2">
        <RadioGroupItem value="option1" id="partial-option1" />
        <label htmlFor="partial-option1" className="cursor-pointer text-sm">
          Option 1
        </label>
      </div>
      <div className="flex items-center gap-2">
        <RadioGroupItem value="option2" id="partial-option2" disabled />
        <label htmlFor="partial-option2" className="cursor-not-allowed text-sm opacity-50">
          Option 2 (Disabled)
        </label>
      </div>
      <div className="flex items-center gap-2">
        <RadioGroupItem value="option3" id="partial-option3" />
        <label htmlFor="partial-option3" className="cursor-pointer text-sm">
          Option 3
        </label>
      </div>
      <div className="flex items-center gap-2">
        <RadioGroupItem value="option4" id="partial-option4" disabled />
        <label htmlFor="partial-option4" className="cursor-not-allowed text-sm opacity-50">
          Option 4 (Disabled)
        </label>
      </div>
    </RadioGroup>
  )
}

// With Descriptions
export const WithDescriptions: Story = {
  render: () => (
    <RadioGroup defaultValue="plan1" className="gap-4">
      <div className="flex items-start gap-3">
        <RadioGroupItem value="plan1" id="plan1" className="mt-1" />
        <label htmlFor="plan1" className="cursor-pointer">
          <div className="text-sm font-medium">Free Plan</div>
          <div className="text-xs text-muted-foreground">Perfect for getting started</div>
        </label>
      </div>
      <div className="flex items-start gap-3">
        <RadioGroupItem value="plan2" id="plan2" className="mt-1" />
        <label htmlFor="plan2" className="cursor-pointer">
          <div className="text-sm font-medium">Pro Plan</div>
          <div className="text-xs text-muted-foreground">For professional developers</div>
        </label>
      </div>
      <div className="flex items-start gap-3">
        <RadioGroupItem value="plan3" id="plan3" className="mt-1" />
        <label htmlFor="plan3" className="cursor-pointer">
          <div className="text-sm font-medium">Enterprise Plan</div>
          <div className="text-xs text-muted-foreground">Advanced features for teams</div>
        </label>
      </div>
    </RadioGroup>
  )
}

// Controlled
export const Controlled: Story = {
  render: function ControlledExample() {
    const [value, setValue] = useState('option1')

    return (
      <div className="flex flex-col gap-4">
        <RadioGroup value={value} onValueChange={setValue}>
          <div className="flex items-center gap-2">
            <RadioGroupItem value="option1" id="controlled-option1" />
            <label htmlFor="controlled-option1" className="cursor-pointer text-sm">
              Option 1
            </label>
          </div>
          <div className="flex items-center gap-2">
            <RadioGroupItem value="option2" id="controlled-option2" />
            <label htmlFor="controlled-option2" className="cursor-pointer text-sm">
              Option 2
            </label>
          </div>
          <div className="flex items-center gap-2">
            <RadioGroupItem value="option3" id="controlled-option3" />
            <label htmlFor="controlled-option3" className="cursor-pointer text-sm">
              Option 3
            </label>
          </div>
        </RadioGroup>
        <div className="text-sm text-muted-foreground">Current value: {value}</div>
      </div>
    )
  }
}

// Sizes
export const Sizes: Story = {
  render: () => (
    <div className="flex flex-col gap-6">
      <div>
        <p className="mb-3 text-sm text-muted-foreground">Small (sm)</p>
        <RadioGroup defaultValue="sm1" className="gap-2">
          <div className="flex items-center gap-2">
            <RadioGroupItem value="sm1" id="size-sm-1" size="sm" />
            <label htmlFor="size-sm-1" className="cursor-pointer text-sm">
              Small Radio
            </label>
          </div>
          <div className="flex items-center gap-2">
            <RadioGroupItem value="sm2" id="size-sm-2" size="sm" />
            <label htmlFor="size-sm-2" className="cursor-pointer text-sm">
              Small Radio
            </label>
          </div>
        </RadioGroup>
      </div>

      <div>
        <p className="mb-3 text-sm text-muted-foreground">Medium (md) - Default</p>
        <RadioGroup defaultValue="md1">
          <div className="flex items-center gap-2">
            <RadioGroupItem value="md1" id="size-md-1" size="md" />
            <label htmlFor="size-md-1" className="cursor-pointer text-sm">
              Medium Radio
            </label>
          </div>
          <div className="flex items-center gap-2">
            <RadioGroupItem value="md2" id="size-md-2" size="md" />
            <label htmlFor="size-md-2" className="cursor-pointer text-sm">
              Medium Radio
            </label>
          </div>
        </RadioGroup>
      </div>

      <div>
        <p className="mb-3 text-sm text-muted-foreground">Large (lg)</p>
        <RadioGroup defaultValue="lg1">
          <div className="flex items-center gap-2">
            <RadioGroupItem value="lg1" id="size-lg-1" size="lg" />
            <label htmlFor="size-lg-1" className="cursor-pointer text-sm">
              Large Radio
            </label>
          </div>
          <div className="flex items-center gap-2">
            <RadioGroupItem value="lg2" id="size-lg-2" size="lg" />
            <label htmlFor="size-lg-2" className="cursor-pointer text-sm">
              Large Radio
            </label>
          </div>
        </RadioGroup>
      </div>
    </div>
  )
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
          <RadioGroup value={normalValue} onValueChange={setNormalValue}>
            <div className="flex items-center gap-2">
              <RadioGroupItem value="option1" id="state-normal-1" />
              <label htmlFor="state-normal-1" className="cursor-pointer text-sm">
                Unselected Option
              </label>
            </div>
          </RadioGroup>
        </div>

        {/* Selected State */}
        <div>
          <p className="mb-2 text-sm text-muted-foreground">Selected State</p>
          <RadioGroup value={selectedValue} onValueChange={setSelectedValue}>
            <div className="flex items-center gap-2">
              <RadioGroupItem value="option2" id="state-selected-2" />
              <label htmlFor="state-selected-2" className="cursor-pointer text-sm">
                Selected Option
              </label>
            </div>
          </RadioGroup>
        </div>

        {/* Disabled State */}
        <div>
          <p className="mb-2 text-sm text-muted-foreground">Disabled State</p>
          <RadioGroup disabled value={selectedValue}>
            <div className="flex items-center gap-2">
              <RadioGroupItem value="option2" id="state-disabled-2" />
              <label htmlFor="state-disabled-2" className="cursor-not-allowed text-sm opacity-50">
                Disabled (Selected)
              </label>
            </div>
          </RadioGroup>
        </div>

        {/* Error State */}
        <div>
          <p className="mb-2 text-sm text-muted-foreground">Error State</p>
          <RadioGroup value="">
            <div className="flex items-center gap-2">
              <RadioGroupItem value="option1" id="state-error-1" aria-invalid />
              <label htmlFor="state-error-1" className="cursor-pointer text-sm">
                Option (Required)
              </label>
            </div>
          </RadioGroup>
          <p className="mt-1 text-xs text-destructive">Please select an option</p>
        </div>
      </div>
    )
  }
}

// Real World Examples
export const RealWorldExamples: Story = {
  render: function RealWorldExample() {
    const [theme, setTheme] = useState('light')
    const [notifications, setNotifications] = useState('all')
    const [visibility, setVisibility] = useState('public')

    return (
      <div className="flex flex-col gap-8">
        {/* Theme Selection */}
        <div>
          <h3 className="mb-3 text-sm font-semibold">Theme Preference</h3>
          <RadioGroup value={theme} onValueChange={setTheme} className="gap-4">
            <div className="flex items-center gap-3">
              <RadioGroupItem value="light" id="theme-light" />
              <label htmlFor="theme-light" className="flex cursor-pointer items-center gap-2 text-sm">
                <Sun className="size-4" />
                Light Mode
              </label>
            </div>
            <div className="flex items-center gap-3">
              <RadioGroupItem value="dark" id="theme-dark" />
              <label htmlFor="theme-dark" className="flex cursor-pointer items-center gap-2 text-sm">
                <Moon className="size-4" />
                Dark Mode
              </label>
            </div>
            <div className="flex items-center gap-3">
              <RadioGroupItem value="system" id="theme-system" />
              <label htmlFor="theme-system" className="flex cursor-pointer items-center gap-2 text-sm">
                <Palette className="size-4" />
                System Default
              </label>
            </div>
          </RadioGroup>
        </div>

        {/* Notification Settings */}
        <div>
          <h3 className="mb-3 text-sm font-semibold">Notification Settings</h3>
          <RadioGroup value={notifications} onValueChange={setNotifications} className="gap-4">
            <div className="flex items-start gap-3">
              <RadioGroupItem value="all" id="notif-all" className="mt-1" />
              <label htmlFor="notif-all" className="cursor-pointer">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Bell className="size-4" />
                  All Notifications
                </div>
                <div className="text-xs text-muted-foreground">Receive all notifications and updates</div>
              </label>
            </div>
            <div className="flex items-start gap-3">
              <RadioGroupItem value="important" id="notif-important" className="mt-1" />
              <label htmlFor="notif-important" className="cursor-pointer">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Check className="size-4" />
                  Important Only
                </div>
                <div className="text-xs text-muted-foreground">Only receive critical notifications</div>
              </label>
            </div>
            <div className="flex items-start gap-3">
              <RadioGroupItem value="none" id="notif-none" className="mt-1" />
              <label htmlFor="notif-none" className="cursor-pointer">
                <div className="text-sm font-medium">None</div>
                <div className="text-xs text-muted-foreground">Turn off all notifications</div>
              </label>
            </div>
          </RadioGroup>
        </div>

        {/* Visibility Settings */}
        <div>
          <h3 className="mb-3 text-sm font-semibold">Profile Visibility</h3>
          <RadioGroup value={visibility} onValueChange={setVisibility}>
            <div className="flex items-center gap-2">
              <RadioGroupItem value="public" id="vis-public" />
              <label htmlFor="vis-public" className="cursor-pointer text-sm">
                Public - Anyone can see your profile
              </label>
            </div>
            <div className="flex items-center gap-2">
              <RadioGroupItem value="friends" id="vis-friends" />
              <label htmlFor="vis-friends" className="cursor-pointer text-sm">
                Friends Only - Only your friends can see
              </label>
            </div>
            <div className="flex items-center gap-2">
              <RadioGroupItem value="private" id="vis-private" />
              <label htmlFor="vis-private" className="cursor-pointer text-sm">
                Private - Only you can see
              </label>
            </div>
          </RadioGroup>
        </div>

        {/* Required Field Example */}
        <div>
          <h3 className="mb-3 text-sm font-semibold">
            Payment Method <span className="text-destructive">*</span>
          </h3>
          <RadioGroup value="">
            <div className="flex items-center gap-2">
              <RadioGroupItem value="credit" id="pay-credit" aria-invalid />
              <label htmlFor="pay-credit" className="cursor-pointer text-sm">
                Credit Card
              </label>
            </div>
            <div className="flex items-center gap-2">
              <RadioGroupItem value="paypal" id="pay-paypal" aria-invalid />
              <label htmlFor="pay-paypal" className="cursor-pointer text-sm">
                PayPal
              </label>
            </div>
            <div className="flex items-center gap-2">
              <RadioGroupItem value="bank" id="pay-bank" aria-invalid />
              <label htmlFor="pay-bank" className="cursor-pointer text-sm">
                Bank Transfer
              </label>
            </div>
          </RadioGroup>
          <p className="mt-1 text-xs text-destructive">Please select a payment method</p>
        </div>
      </div>
    )
  }
}

// Card Style
export const CardStyle: Story = {
  render: () => (
    <RadioGroup defaultValue="starter" className="gap-4">
      <label
        htmlFor="card-starter"
        className="flex cursor-pointer items-start gap-3 rounded-lg border border-input p-4 transition-colors hover:bg-accent/50 has-[:checked]:border-primary has-[:checked]:bg-accent">
        <RadioGroupItem value="starter" id="card-starter" className="mt-1" />
        <div className="flex-1">
          <div className="text-sm font-semibold">Starter</div>
          <div className="text-xs text-muted-foreground">Best for individual use</div>
          <div className="mt-2 text-lg font-bold">$9/month</div>
        </div>
      </label>

      <label
        htmlFor="card-pro"
        className="flex cursor-pointer items-start gap-3 rounded-lg border border-input p-4 transition-colors hover:bg-accent/50 has-[:checked]:border-primary has-[:checked]:bg-accent">
        <RadioGroupItem value="pro" id="card-pro" className="mt-1" />
        <div className="flex-1">
          <div className="text-sm font-semibold">Pro</div>
          <div className="text-xs text-muted-foreground">For professional developers</div>
          <div className="mt-2 text-lg font-bold">$29/month</div>
        </div>
      </label>

      <label
        htmlFor="card-enterprise"
        className="flex cursor-pointer items-start gap-3 rounded-lg border border-input p-4 transition-colors hover:bg-accent/50 has-[:checked]:border-primary has-[:checked]:bg-accent">
        <RadioGroupItem value="enterprise" id="card-enterprise" className="mt-1" />
        <div className="flex-1">
          <div className="text-sm font-semibold">Enterprise</div>
          <div className="text-xs text-muted-foreground">For large teams</div>
          <div className="mt-2 text-lg font-bold">Custom pricing</div>
        </div>
      </label>
    </RadioGroup>
  )
}
