import { DescriptionSwitch, Switch } from '@cherrystudio/ui'
import type { Meta, StoryObj } from '@storybook/react'
import { Bell, Moon, Shield, Wifi, Zap } from 'lucide-react'
import { useState } from 'react'

const meta: Meta<typeof Switch> = {
  title: 'Components/Primitives/Switch',
  component: Switch,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'A switch component based on Radix UI Switch, allowing users to toggle between on/off states. Supports three sizes (sm, md, lg), loading states, and an enhanced DescriptionSwitch variant with label and description. Built with accessibility in mind.'
      }
    }
  },
  tags: ['autodocs'],
  argTypes: {
    disabled: {
      control: { type: 'boolean' },
      description: 'Whether the switch is disabled'
    },
    loading: {
      control: { type: 'boolean' },
      description: 'When true, displays a loading animation in the switch thumb'
    },
    size: {
      control: { type: 'select' },
      options: ['sm', 'md', 'lg'],
      description: 'The size of the switch'
    },
    defaultChecked: {
      control: { type: 'boolean' },
      description: 'Default checked state'
    },
    checked: {
      control: { type: 'boolean' },
      description: 'Checked state in controlled mode'
    }
  }
}

export default meta
type Story = StoryObj<typeof meta>

// Default
export const Default: Story = {
  render: () => (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <Switch id="default1" />
        <label htmlFor="default1" className="cursor-pointer text-sm">
          Enable notifications
        </label>
      </div>
      <div className="flex items-center gap-2">
        <Switch id="default2" />
        <label htmlFor="default2" className="cursor-pointer text-sm">
          Auto-save changes
        </label>
      </div>
      <div className="flex items-center gap-2">
        <Switch id="default3" />
        <label htmlFor="default3" className="cursor-pointer text-sm">
          Dark mode
        </label>
      </div>
    </div>
  )
}

// With Default Checked
export const WithDefaultChecked: Story = {
  render: () => (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <Switch id="checked1" defaultChecked />
        <label htmlFor="checked1" className="cursor-pointer text-sm">
          Option 1 (Default On)
        </label>
      </div>
      <div className="flex items-center gap-2">
        <Switch id="checked2" />
        <label htmlFor="checked2" className="cursor-pointer text-sm">
          Option 2
        </label>
      </div>
      <div className="flex items-center gap-2">
        <Switch id="checked3" defaultChecked />
        <label htmlFor="checked3" className="cursor-pointer text-sm">
          Option 3 (Default On)
        </label>
      </div>
    </div>
  )
}

// Disabled
export const Disabled: Story = {
  render: () => (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <Switch id="disabled1" disabled />
        <label htmlFor="disabled1" className="cursor-not-allowed text-sm opacity-50">
          Disabled (Off)
        </label>
      </div>
      <div className="flex items-center gap-2">
        <Switch id="disabled2" disabled defaultChecked />
        <label htmlFor="disabled2" className="cursor-not-allowed text-sm opacity-50">
          Disabled (On)
        </label>
      </div>
    </div>
  )
}

// Loading State
export const Loading: Story = {
  render: () => (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <Switch id="loading1" loading />
        <label htmlFor="loading1" className="cursor-pointer text-sm">
          Loading state (Off)
        </label>
      </div>
      <div className="flex items-center gap-2">
        <Switch id="loading2" loading defaultChecked />
        <label htmlFor="loading2" className="cursor-pointer text-sm">
          Loading state (On)
        </label>
      </div>
      <div className="flex items-center gap-2">
        <Switch id="loading3" loading disabled defaultChecked />
        <label htmlFor="loading3" className="cursor-not-allowed text-sm opacity-50">
          Loading + Disabled
        </label>
      </div>
    </div>
  )
}

// Controlled
export const Controlled: Story = {
  render: function ControlledExample() {
    const [checked, setChecked] = useState(false)

    return (
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-2">
          <Switch id="controlled" checked={checked} onCheckedChange={setChecked} />
          <label htmlFor="controlled" className="cursor-pointer text-sm">
            Controlled switch
          </label>
        </div>
        <div className="text-sm text-muted-foreground">Current state: {checked ? 'On' : 'Off'}</div>
        <button
          type="button"
          onClick={() => setChecked(!checked)}
          className="w-fit rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90">
          Toggle State
        </button>
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
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <Switch id="size-sm-1" size="sm" />
            <label htmlFor="size-sm-1" className="cursor-pointer text-sm">
              Small switch
            </label>
          </div>
          <div className="flex items-center gap-2">
            <Switch id="size-sm-2" size="sm" defaultChecked />
            <label htmlFor="size-sm-2" className="cursor-pointer text-sm">
              Small switch (on)
            </label>
          </div>
          <div className="flex items-center gap-2">
            <Switch id="size-sm-3" size="sm" loading defaultChecked />
            <label htmlFor="size-sm-3" className="cursor-pointer text-sm">
              Small switch (loading)
            </label>
          </div>
        </div>
      </div>

      <div>
        <p className="mb-3 text-sm text-muted-foreground">Medium (md) - Default</p>
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <Switch id="size-md-1" size="md" />
            <label htmlFor="size-md-1" className="cursor-pointer text-sm">
              Medium switch
            </label>
          </div>
          <div className="flex items-center gap-2">
            <Switch id="size-md-2" size="md" defaultChecked />
            <label htmlFor="size-md-2" className="cursor-pointer text-sm">
              Medium switch (on)
            </label>
          </div>
          <div className="flex items-center gap-2">
            <Switch id="size-md-3" size="md" loading defaultChecked />
            <label htmlFor="size-md-3" className="cursor-pointer text-sm">
              Medium switch (loading)
            </label>
          </div>
        </div>
      </div>

      <div>
        <p className="mb-3 text-sm text-muted-foreground">Large (lg)</p>
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <Switch id="size-lg-1" size="lg" />
            <label htmlFor="size-lg-1" className="cursor-pointer text-sm">
              Large switch
            </label>
          </div>
          <div className="flex items-center gap-2">
            <Switch id="size-lg-2" size="lg" defaultChecked />
            <label htmlFor="size-lg-2" className="cursor-pointer text-sm">
              Large switch (on)
            </label>
          </div>
          <div className="flex items-center gap-2">
            <Switch id="size-lg-3" size="lg" loading defaultChecked />
            <label htmlFor="size-lg-3" className="cursor-pointer text-sm">
              Large switch (loading)
            </label>
          </div>
        </div>
      </div>
    </div>
  )
}

// Description Switch - Basic
export const DescriptionSwitchBasic: Story = {
  render: () => (
    <div className="flex w-96 flex-col gap-4">
      <DescriptionSwitch label="Enable notifications" description="Receive alerts for important updates" />
      <DescriptionSwitch label="Auto-save" description="Automatically save changes as you work" defaultChecked />
      <DescriptionSwitch label="Dark mode" description="Use dark theme for better visibility at night" />
    </div>
  )
}

// Description Switch - Positions
export const DescriptionSwitchPositions: Story = {
  render: () => (
    <div className="flex w-96 flex-col gap-6">
      <div>
        <p className="mb-3 text-sm text-muted-foreground">Switch on Right (Default)</p>
        <div className="flex flex-col gap-4">
          <DescriptionSwitch
            label="Email notifications"
            description="Get notified about new messages"
            position="right"
          />
          <DescriptionSwitch label="Marketing emails" description="Receive promotional content" position="right" />
        </div>
      </div>

      <div>
        <p className="mb-3 text-sm text-muted-foreground">Switch on Left</p>
        <div className="flex flex-col gap-4">
          <DescriptionSwitch
            label="Email notifications"
            description="Get notified about new messages"
            position="left"
          />
          <DescriptionSwitch label="Marketing emails" description="Receive promotional content" position="left" />
        </div>
      </div>
    </div>
  )
}

// Description Switch - Sizes
export const DescriptionSwitchSizes: Story = {
  render: () => (
    <div className="flex w-96 flex-col gap-6">
      <DescriptionSwitch label="Small switch" description="Compact size for dense layouts" size="sm" />
      <DescriptionSwitch label="Medium switch" description="Default size for most use cases" size="md" defaultChecked />
      <DescriptionSwitch label="Large switch" description="Larger size for emphasis" size="lg" />
    </div>
  )
}

// Description Switch - States
export const DescriptionSwitchStates: Story = {
  render: () => (
    <div className="flex w-96 flex-col gap-4">
      <DescriptionSwitch label="Normal state" description="Default interactive state" />
      <DescriptionSwitch label="Checked state" description="Currently enabled" defaultChecked />
      <DescriptionSwitch label="Disabled state" description="Cannot be toggled" disabled />
      <DescriptionSwitch label="Disabled + Checked" description="Enabled but locked" disabled defaultChecked />
      <DescriptionSwitch label="Loading state" description="Processing your request" loading defaultChecked />
    </div>
  )
}

// Size Comparison
export const SizeComparison: Story = {
  render: () => (
    <div className="flex items-center gap-6">
      <div className="flex flex-col gap-4">
        <p className="text-xs font-medium text-muted-foreground">Off</p>
        <div className="flex items-center gap-4">
          <div className="flex flex-col items-center gap-2">
            <Switch id="compare-sm-1" size="sm" />
            <span className="text-xs text-muted-foreground">sm</span>
          </div>
          <div className="flex flex-col items-center gap-2">
            <Switch id="compare-md-1" size="md" />
            <span className="text-xs text-muted-foreground">md</span>
          </div>
          <div className="flex flex-col items-center gap-2">
            <Switch id="compare-lg-1" size="lg" />
            <span className="text-xs text-muted-foreground">lg</span>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-4">
        <p className="text-xs font-medium text-muted-foreground">On</p>
        <div className="flex items-center gap-4">
          <div className="flex flex-col items-center gap-2">
            <Switch id="compare-sm-2" size="sm" defaultChecked />
            <span className="text-xs text-muted-foreground">sm</span>
          </div>
          <div className="flex flex-col items-center gap-2">
            <Switch id="compare-md-2" size="md" defaultChecked />
            <span className="text-xs text-muted-foreground">md</span>
          </div>
          <div className="flex flex-col items-center gap-2">
            <Switch id="compare-lg-2" size="lg" defaultChecked />
            <span className="text-xs text-muted-foreground">lg</span>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-4">
        <p className="text-xs font-medium text-muted-foreground">Loading</p>
        <div className="flex items-center gap-4">
          <div className="flex flex-col items-center gap-2">
            <Switch id="compare-sm-3" size="sm" loading defaultChecked />
            <span className="text-xs text-muted-foreground">sm</span>
          </div>
          <div className="flex flex-col items-center gap-2">
            <Switch id="compare-md-3" size="md" loading defaultChecked />
            <span className="text-xs text-muted-foreground">md</span>
          </div>
          <div className="flex flex-col items-center gap-2">
            <Switch id="compare-lg-3" size="lg" loading defaultChecked />
            <span className="text-xs text-muted-foreground">lg</span>
          </div>
        </div>
      </div>
    </div>
  )
}

// Real World Examples
export const RealWorldExamples: Story = {
  render: function RealWorldExample() {
    const [settings, setSettings] = useState({
      notifications: true,
      autoSave: true,
      darkMode: false,
      analytics: true
    })

    const [privacy, setPrivacy] = useState({
      shareData: false,
      allowCookies: true,
      trackLocation: false,
      personalizedAds: false
    })

    return (
      <div className="flex w-[500px] flex-col gap-8">
        {/* General Settings */}
        <div>
          <h3 className="mb-4 text-base font-semibold">General Settings</h3>
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <Switch
                id="settings-notifications"
                checked={settings.notifications}
                onCheckedChange={(checked) => setSettings({ ...settings, notifications: !!checked })}
              />
              <label htmlFor="settings-notifications" className="flex cursor-pointer items-center gap-2 text-sm">
                <Bell className="size-4" />
                Push Notifications
              </label>
            </div>
            <div className="flex items-center gap-3">
              <Switch
                id="settings-autosave"
                checked={settings.autoSave}
                onCheckedChange={(checked) => setSettings({ ...settings, autoSave: !!checked })}
              />
              <label htmlFor="settings-autosave" className="flex cursor-pointer items-center gap-2 text-sm">
                <Zap className="size-4" />
                Auto-save Changes
              </label>
            </div>
            <div className="flex items-center gap-3">
              <Switch
                id="settings-darkmode"
                checked={settings.darkMode}
                onCheckedChange={(checked) => setSettings({ ...settings, darkMode: !!checked })}
              />
              <label htmlFor="settings-darkmode" className="flex cursor-pointer items-center gap-2 text-sm">
                <Moon className="size-4" />
                Dark Mode
              </label>
            </div>
            <div className="flex items-center gap-3">
              <Switch
                id="settings-analytics"
                checked={settings.analytics}
                onCheckedChange={(checked) => setSettings({ ...settings, analytics: !!checked })}
              />
              <label htmlFor="settings-analytics" className="flex cursor-pointer items-center gap-2 text-sm">
                <Shield className="size-4" />
                Usage Analytics
              </label>
            </div>
          </div>
        </div>

        {/* Privacy Settings with DescriptionSwitch */}
        <div>
          <h3 className="mb-4 text-base font-semibold">Privacy Settings</h3>
          <div className="flex flex-col gap-4">
            <DescriptionSwitch
              label="Share usage data"
              description="Help us improve by sharing anonymous usage statistics"
              checked={privacy.shareData}
              onCheckedChange={(checked) => setPrivacy({ ...privacy, shareData: !!checked })}
            />
            <DescriptionSwitch
              label="Allow cookies"
              description="Enable cookies for better user experience"
              checked={privacy.allowCookies}
              onCheckedChange={(checked) => setPrivacy({ ...privacy, allowCookies: !!checked })}
            />
            <DescriptionSwitch
              label="Track location"
              description="Use your location for personalized content"
              checked={privacy.trackLocation}
              onCheckedChange={(checked) => setPrivacy({ ...privacy, trackLocation: !!checked })}
            />
            <DescriptionSwitch
              label="Personalized ads"
              description="Show ads based on your interests"
              checked={privacy.personalizedAds}
              onCheckedChange={(checked) => setPrivacy({ ...privacy, personalizedAds: !!checked })}
            />
          </div>
        </div>
      </div>
    )
  }
}

// Interactive Loading Example
export const InteractiveLoading: Story = {
  render: function InteractiveLoadingExample() {
    const [isLoading, setIsLoading] = useState(false)
    const [isEnabled, setIsEnabled] = useState(false)

    const handleToggle = async (checked: boolean) => {
      setIsLoading(true)
      // Simulate API call
      await new Promise((resolve) => setTimeout(resolve, 2000))
      setIsEnabled(checked)
      setIsLoading(false)
    }

    return (
      <div className="flex flex-col gap-6">
        <div className="flex w-96 flex-col gap-4">
          <DescriptionSwitch
            label="Wi-Fi Connection"
            description="Connect to wireless networks"
            checked={isEnabled}
            onCheckedChange={handleToggle}
            loading={isLoading}
            disabled={isLoading}
          />
          <div className="rounded-md bg-muted p-4">
            <div className="flex items-center gap-2 text-sm">
              <Wifi className="size-4" />
              <span className="font-medium">Status:</span>
              <span className="text-muted-foreground">
                {isLoading ? 'Connecting...' : isEnabled ? 'Connected' : 'Disconnected'}
              </span>
            </div>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">Click the switch to see a simulated 2-second loading state</p>
      </div>
    )
  }
}

// Form Example
export const FormExample: Story = {
  render: function FormExample() {
    const [formData, setFormData] = useState({
      emailNotifications: true,
      pushNotifications: false,
      smsNotifications: false,
      newsletter: true,
      twoFactorAuth: false,
      biometricAuth: true
    })

    const [isSaving, setIsSaving] = useState(false)
    const [saved, setSaved] = useState(false)

    const handleSubmit = async (e: React.FormEvent) => {
      e.preventDefault()
      setIsSaving(true)
      setSaved(false)
      // Simulate API call
      await new Promise((resolve) => setTimeout(resolve, 1500))
      setIsSaving(false)
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    }

    return (
      <form onSubmit={handleSubmit} className="w-[500px] space-y-6">
        <h3 className="text-base font-semibold">Account Preferences</h3>

        <div className="space-y-4">
          <div>
            <h4 className="mb-3 text-sm font-medium">Notifications</h4>
            <div className="space-y-3">
              <DescriptionSwitch
                label="Email notifications"
                description="Receive updates via email"
                checked={formData.emailNotifications}
                onCheckedChange={(checked) => setFormData({ ...formData, emailNotifications: !!checked })}
                disabled={isSaving}
              />
              <DescriptionSwitch
                label="Push notifications"
                description="Get instant alerts on your device"
                checked={formData.pushNotifications}
                onCheckedChange={(checked) => setFormData({ ...formData, pushNotifications: !!checked })}
                disabled={isSaving}
              />
              <DescriptionSwitch
                label="SMS notifications"
                description="Receive text message alerts"
                checked={formData.smsNotifications}
                onCheckedChange={(checked) => setFormData({ ...formData, smsNotifications: !!checked })}
                disabled={isSaving}
              />
              <DescriptionSwitch
                label="Newsletter subscription"
                description="Stay updated with our latest news"
                checked={formData.newsletter}
                onCheckedChange={(checked) => setFormData({ ...formData, newsletter: !!checked })}
                disabled={isSaving}
              />
            </div>
          </div>

          <div>
            <h4 className="mb-3 text-sm font-medium">Security</h4>
            <div className="space-y-3">
              <DescriptionSwitch
                label="Two-factor authentication"
                description="Add an extra layer of security"
                checked={formData.twoFactorAuth}
                onCheckedChange={(checked) => setFormData({ ...formData, twoFactorAuth: !!checked })}
                disabled={isSaving}
              />
              <DescriptionSwitch
                label="Biometric authentication"
                description="Use fingerprint or face recognition"
                checked={formData.biometricAuth}
                onCheckedChange={(checked) => setFormData({ ...formData, biometricAuth: !!checked })}
                disabled={isSaving}
              />
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={isSaving}
            className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
            {isSaving ? 'Saving...' : 'Save Changes'}
          </button>
          {saved && <p className="text-sm text-green-600">Settings saved successfully!</p>}
        </div>
      </form>
    )
  }
}

// Accessibility Example
export const Accessibility: Story = {
  render: () => (
    <div className="flex w-96 flex-col gap-6">
      <div>
        <h3 className="mb-4 text-base font-semibold">Keyboard Navigation</h3>
        <p className="mb-4 text-sm text-muted-foreground">
          Use Tab to navigate between switches and Space/Enter to toggle them.
        </p>
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <Switch id="a11y-1" />
            <label htmlFor="a11y-1" className="cursor-pointer text-sm">
              First switch
            </label>
          </div>
          <div className="flex items-center gap-2">
            <Switch id="a11y-2" />
            <label htmlFor="a11y-2" className="cursor-pointer text-sm">
              Second switch
            </label>
          </div>
          <div className="flex items-center gap-2">
            <Switch id="a11y-3" />
            <label htmlFor="a11y-3" className="cursor-pointer text-sm">
              Third switch
            </label>
          </div>
        </div>
      </div>

      <div>
        <h3 className="mb-4 text-base font-semibold">ARIA Labels</h3>
        <p className="mb-4 text-sm text-muted-foreground">
          Switches include proper ARIA attributes for screen reader support.
        </p>
        <DescriptionSwitch
          label="Accessibility features"
          description="Enable enhanced accessibility options for better usability"
          defaultChecked
        />
      </div>
    </div>
  )
}
