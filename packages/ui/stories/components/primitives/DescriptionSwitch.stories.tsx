import type { Meta, StoryObj } from '@storybook/react'
import { Bell, Eye, Lock, Moon, Shield, Wifi, Zap } from 'lucide-react'
import { useState } from 'react'

import { DescriptionSwitch } from '../../../src/components/primitives/switch'

const meta: Meta<typeof DescriptionSwitch> = {
  title: 'Components/Primitives/DescriptionSwitch',
  component: DescriptionSwitch,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'An enhanced Switch component with integrated label and optional description text. Perfect for settings panels and preference forms where context is important. Built on top of the Radix UI Switch primitive with support for multiple sizes, loading states, and flexible positioning.'
      }
    }
  },
  tags: ['autodocs'],
  argTypes: {
    label: {
      control: { type: 'text' },
      description: 'Text label displayed next to the switch (required)'
    },
    description: {
      control: { type: 'text' },
      description: 'Optional helper text shown below the label'
    },
    position: {
      control: { type: 'select' },
      options: ['left', 'right'],
      description: 'Switch position relative to label'
    },
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
    <div className="w-[400px]">
      <DescriptionSwitch label="Enable notifications" description="Receive alerts for important updates" />
    </div>
  )
}

// Without Description
export const WithoutDescription: Story = {
  render: () => (
    <div className="flex w-[400px] flex-col gap-4">
      <DescriptionSwitch label="Enable notifications" />
      <DescriptionSwitch label="Auto-save changes" defaultChecked />
      <DescriptionSwitch label="Dark mode" />
    </div>
  )
}

// With Description
export const WithDescription: Story = {
  render: () => (
    <div className="flex w-[400px] flex-col gap-4">
      <DescriptionSwitch label="Enable notifications" description="Receive alerts for important updates" />
      <DescriptionSwitch
        label="Auto-save changes"
        description="Automatically save your work as you type"
        defaultChecked
      />
      <DescriptionSwitch label="Dark mode" description="Use dark theme for better visibility at night" />
    </div>
  )
}

// Positions
export const Positions: Story = {
  render: () => (
    <div className="flex w-[500px] flex-col gap-8">
      <div>
        <h3 className="mb-4 text-sm font-semibold">Switch on Right (Default)</h3>
        <div className="flex flex-col gap-4">
          <DescriptionSwitch
            label="Email notifications"
            description="Get notified about new messages and updates"
            position="right"
          />
          <DescriptionSwitch
            label="Push notifications"
            description="Receive instant alerts on your device"
            position="right"
            defaultChecked
          />
          <DescriptionSwitch
            label="Marketing emails"
            description="Stay informed about new features and offers"
            position="right"
          />
        </div>
      </div>

      <div>
        <h3 className="mb-4 text-sm font-semibold">Switch on Left</h3>
        <div className="flex flex-col gap-4">
          <DescriptionSwitch
            label="Email notifications"
            description="Get notified about new messages and updates"
            position="left"
          />
          <DescriptionSwitch
            label="Push notifications"
            description="Receive instant alerts on your device"
            position="left"
            defaultChecked
          />
          <DescriptionSwitch
            label="Marketing emails"
            description="Stay informed about new features and offers"
            position="left"
          />
        </div>
      </div>
    </div>
  )
}

// Sizes
export const Sizes: Story = {
  render: () => (
    <div className="flex w-[400px] flex-col gap-6">
      <div>
        <p className="mb-3 text-sm text-muted-foreground">Small (sm)</p>
        <DescriptionSwitch
          label="Small switch"
          description="Compact size for dense layouts and space-constrained interfaces"
          size="sm"
        />
      </div>

      <div>
        <p className="mb-3 text-sm text-muted-foreground">Medium (md) - Default</p>
        <DescriptionSwitch
          label="Medium switch"
          description="Default size that works well in most situations"
          size="md"
          defaultChecked
        />
      </div>

      <div>
        <p className="mb-3 text-sm text-muted-foreground">Large (lg)</p>
        <DescriptionSwitch
          label="Large switch"
          description="Larger size for emphasis and improved touch targets"
          size="lg"
        />
      </div>
    </div>
  )
}

// States
export const States: Story = {
  render: () => (
    <div className="flex w-[400px] flex-col gap-4">
      <div>
        <p className="mb-3 text-sm text-muted-foreground">Normal (Unchecked)</p>
        <DescriptionSwitch label="Normal state" description="Default interactive state, ready to be toggled" />
      </div>

      <div>
        <p className="mb-3 text-sm text-muted-foreground">Checked</p>
        <DescriptionSwitch label="Checked state" description="Currently enabled and active" defaultChecked />
      </div>

      <div>
        <p className="mb-3 text-sm text-muted-foreground">Disabled (Unchecked)</p>
        <DescriptionSwitch label="Disabled state" description="Cannot be toggled, currently inactive" disabled />
      </div>

      <div>
        <p className="mb-3 text-sm text-muted-foreground">Disabled (Checked)</p>
        <DescriptionSwitch
          label="Disabled state"
          description="Enabled but locked, cannot be changed"
          disabled
          defaultChecked
        />
      </div>

      <div>
        <p className="mb-3 text-sm text-muted-foreground">Loading</p>
        <DescriptionSwitch
          label="Loading state"
          description="Processing your request, please wait"
          loading
          defaultChecked
        />
      </div>
    </div>
  )
}

// Controlled
export const Controlled: Story = {
  render: function ControlledExample() {
    const [checked, setChecked] = useState(false)

    return (
      <div className="flex flex-col gap-6">
        <div className="w-[400px]">
          <DescriptionSwitch
            label="Controlled switch"
            description="This switch is controlled by React state"
            checked={checked}
            onCheckedChange={setChecked}
          />
        </div>
        <div className="flex items-center gap-4">
          <div className="text-sm text-muted-foreground">Current state: {checked ? 'On' : 'Off'}</div>
          <button
            type="button"
            onClick={() => setChecked(!checked)}
            className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90">
            Toggle State
          </button>
        </div>
      </div>
    )
  }
}

// Long Text
export const LongText: Story = {
  render: () => (
    <div className="flex w-[500px] flex-col gap-4">
      <DescriptionSwitch
        label="Enable comprehensive analytics and tracking"
        description="When enabled, this feature will collect and analyze detailed usage statistics, user behavior patterns, interaction data, and performance metrics to help improve the application experience and provide personalized recommendations."
      />
      <DescriptionSwitch
        label="Short label"
        description="This is a very long description that explains in great detail what this particular setting does, why it might be useful, what the implications are of enabling or disabling it, and any other relevant information that users should know before making a decision."
        defaultChecked
      />
    </div>
  )
}

// Notification Settings Example
export const NotificationSettings: Story = {
  render: function NotificationSettingsExample() {
    const [notifications, setNotifications] = useState({
      email: true,
      push: false,
      sms: false,
      desktop: true,
      mobile: false,
      weekly: true
    })

    return (
      <div className="w-[500px] space-y-6">
        <div>
          <h3 className="mb-4 text-base font-semibold">Notification Preferences</h3>
          <div className="flex flex-col gap-4">
            <DescriptionSwitch
              label="Email notifications"
              description="Receive updates and alerts via email"
              checked={notifications.email}
              onCheckedChange={(checked) => setNotifications({ ...notifications, email: !!checked })}
            />
            <DescriptionSwitch
              label="Push notifications"
              description="Get instant notifications on this device"
              checked={notifications.push}
              onCheckedChange={(checked) => setNotifications({ ...notifications, push: !!checked })}
            />
            <DescriptionSwitch
              label="SMS notifications"
              description="Receive text message alerts for critical updates"
              checked={notifications.sms}
              onCheckedChange={(checked) => setNotifications({ ...notifications, sms: !!checked })}
            />
            <DescriptionSwitch
              label="Desktop notifications"
              description="Show notifications on your desktop"
              checked={notifications.desktop}
              onCheckedChange={(checked) => setNotifications({ ...notifications, desktop: !!checked })}
            />
            <DescriptionSwitch
              label="Mobile notifications"
              description="Receive alerts on your mobile device"
              checked={notifications.mobile}
              onCheckedChange={(checked) => setNotifications({ ...notifications, mobile: !!checked })}
            />
            <DescriptionSwitch
              label="Weekly digest"
              description="Get a summary of activity every week"
              checked={notifications.weekly}
              onCheckedChange={(checked) => setNotifications({ ...notifications, weekly: !!checked })}
            />
          </div>
        </div>
      </div>
    )
  }
}

// Privacy Settings Example
export const PrivacySettings: Story = {
  render: function PrivacySettingsExample() {
    const [privacy, setPrivacy] = useState({
      profileVisible: true,
      activityTracking: false,
      dataSharing: false,
      personalization: true,
      thirdParty: false
    })

    return (
      <div className="w-[500px] space-y-6">
        <div>
          <h3 className="mb-4 text-base font-semibold">Privacy & Data</h3>
          <div className="flex flex-col gap-4">
            <DescriptionSwitch
              label="Public profile"
              description="Make your profile visible to other users"
              checked={privacy.profileVisible}
              onCheckedChange={(checked) => setPrivacy({ ...privacy, profileVisible: !!checked })}
            />
            <DescriptionSwitch
              label="Activity tracking"
              description="Allow us to track your activity to improve services"
              checked={privacy.activityTracking}
              onCheckedChange={(checked) => setPrivacy({ ...privacy, activityTracking: !!checked })}
            />
            <DescriptionSwitch
              label="Data sharing"
              description="Share anonymous usage data with partners"
              checked={privacy.dataSharing}
              onCheckedChange={(checked) => setPrivacy({ ...privacy, dataSharing: !!checked })}
            />
            <DescriptionSwitch
              label="Personalization"
              description="Use your data to personalize your experience"
              checked={privacy.personalization}
              onCheckedChange={(checked) => setPrivacy({ ...privacy, personalization: !!checked })}
            />
            <DescriptionSwitch
              label="Third-party cookies"
              description="Allow third-party cookies for enhanced features"
              checked={privacy.thirdParty}
              onCheckedChange={(checked) => setPrivacy({ ...privacy, thirdParty: !!checked })}
            />
          </div>
        </div>
      </div>
    )
  }
}

// Application Settings Example
export const ApplicationSettings: Story = {
  render: function ApplicationSettingsExample() {
    const [settings, setSettings] = useState({
      autoSave: true,
      spellCheck: true,
      darkMode: false,
      compactMode: false,
      animations: true,
      sound: false,
      offlineMode: false
    })

    return (
      <div className="w-[500px] space-y-6">
        <div>
          <h3 className="mb-4 text-base font-semibold">Application Settings</h3>
          <div className="flex flex-col gap-4">
            <DescriptionSwitch
              label="Auto-save"
              description="Automatically save your work every few minutes"
              checked={settings.autoSave}
              onCheckedChange={(checked) => setSettings({ ...settings, autoSave: !!checked })}
            />
            <DescriptionSwitch
              label="Spell check"
              description="Check spelling as you type"
              checked={settings.spellCheck}
              onCheckedChange={(checked) => setSettings({ ...settings, spellCheck: !!checked })}
            />
            <DescriptionSwitch
              label="Dark mode"
              description="Use dark theme throughout the application"
              checked={settings.darkMode}
              onCheckedChange={(checked) => setSettings({ ...settings, darkMode: !!checked })}
            />
            <DescriptionSwitch
              label="Compact mode"
              description="Reduce spacing for a more dense layout"
              checked={settings.compactMode}
              onCheckedChange={(checked) => setSettings({ ...settings, compactMode: !!checked })}
            />
            <DescriptionSwitch
              label="Animations"
              description="Enable smooth transitions and animations"
              checked={settings.animations}
              onCheckedChange={(checked) => setSettings({ ...settings, animations: !!checked })}
            />
            <DescriptionSwitch
              label="Sound effects"
              description="Play sounds for notifications and actions"
              checked={settings.sound}
              onCheckedChange={(checked) => setSettings({ ...settings, sound: !!checked })}
            />
            <DescriptionSwitch
              label="Offline mode"
              description="Enable working without internet connection"
              checked={settings.offlineMode}
              onCheckedChange={(checked) => setSettings({ ...settings, offlineMode: !!checked })}
            />
          </div>
        </div>
      </div>
    )
  }
}

// With Icons
export const WithIcons: Story = {
  render: () => (
    <div className="flex w-[500px] flex-col gap-4">
      <div className="flex items-start gap-3">
        <Bell className="mt-1 size-5 text-muted-foreground" />
        <div className="flex-1">
          <DescriptionSwitch label="Notifications" description="Receive alerts for important updates" defaultChecked />
        </div>
      </div>
      <div className="flex items-start gap-3">
        <Moon className="mt-1 size-5 text-muted-foreground" />
        <div className="flex-1">
          <DescriptionSwitch label="Dark mode" description="Use dark theme for better visibility at night" />
        </div>
      </div>
      <div className="flex items-start gap-3">
        <Shield className="mt-1 size-5 text-muted-foreground" />
        <div className="flex-1">
          <DescriptionSwitch
            label="Two-factor authentication"
            description="Add an extra layer of security to your account"
          />
        </div>
      </div>
      <div className="flex items-start gap-3">
        <Wifi className="mt-1 size-5 text-muted-foreground" />
        <div className="flex-1">
          <DescriptionSwitch label="Offline mode" description="Work without internet connection" defaultChecked />
        </div>
      </div>
      <div className="flex items-start gap-3">
        <Zap className="mt-1 size-5 text-muted-foreground" />
        <div className="flex-1">
          <DescriptionSwitch
            label="Performance mode"
            description="Optimize for speed and responsiveness"
            defaultChecked
          />
        </div>
      </div>
    </div>
  )
}

// Loading Simulation
export const LoadingSimulation: Story = {
  render: function LoadingSimulationExample() {
    const [states, setStates] = useState({
      wifi: { enabled: false, loading: false },
      bluetooth: { enabled: false, loading: false },
      location: { enabled: false, loading: false }
    })

    const handleToggle = async (setting: keyof typeof states, checked: boolean) => {
      setStates((prev) => ({
        ...prev,
        [setting]: { ...prev[setting], loading: true }
      }))

      // Simulate API call
      await new Promise((resolve) => setTimeout(resolve, 1500))

      setStates((prev) => ({
        ...prev,
        [setting]: { enabled: checked, loading: false }
      }))
    }

    return (
      <div className="w-[500px] space-y-6">
        <div>
          <h3 className="mb-4 text-base font-semibold">System Settings</h3>
          <div className="flex flex-col gap-4">
            <DescriptionSwitch
              label="Wi-Fi"
              description="Connect to wireless networks"
              checked={states.wifi.enabled}
              onCheckedChange={(checked) => handleToggle('wifi', !!checked)}
              loading={states.wifi.loading}
              disabled={states.wifi.loading}
            />
            <DescriptionSwitch
              label="Bluetooth"
              description="Connect to Bluetooth devices"
              checked={states.bluetooth.enabled}
              onCheckedChange={(checked) => handleToggle('bluetooth', !!checked)}
              loading={states.bluetooth.loading}
              disabled={states.bluetooth.loading}
            />
            <DescriptionSwitch
              label="Location services"
              description="Allow apps to use your location"
              checked={states.location.enabled}
              onCheckedChange={(checked) => handleToggle('location', !!checked)}
              loading={states.location.loading}
              disabled={states.location.loading}
            />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">Toggle switches to see a simulated 1.5-second loading state</p>
      </div>
    )
  }
}

// Complex Settings Panel
export const ComplexSettingsPanel: Story = {
  render: function ComplexSettingsPanelExample() {
    const [settings, setSettings] = useState({
      notifications: {
        email: true,
        push: false,
        desktop: true
      },
      privacy: {
        profile: true,
        activity: false,
        analytics: true
      },
      features: {
        autoSave: true,
        darkMode: false,
        compactView: false
      },
      security: {
        twoFactor: false,
        biometric: true,
        sessionTimeout: false
      }
    })

    return (
      <div className="w-[600px] space-y-8">
        {/* Notifications Section */}
        <div>
          <div className="mb-4 flex items-center gap-2">
            <Bell className="size-5" />
            <h3 className="text-base font-semibold">Notifications</h3>
          </div>
          <div className="flex flex-col gap-4">
            <DescriptionSwitch
              label="Email notifications"
              description="Receive updates and alerts via email"
              checked={settings.notifications.email}
              onCheckedChange={(checked) =>
                setSettings({
                  ...settings,
                  notifications: { ...settings.notifications, email: !!checked }
                })
              }
            />
            <DescriptionSwitch
              label="Push notifications"
              description="Get instant notifications on this device"
              checked={settings.notifications.push}
              onCheckedChange={(checked) =>
                setSettings({
                  ...settings,
                  notifications: { ...settings.notifications, push: !!checked }
                })
              }
            />
            <DescriptionSwitch
              label="Desktop notifications"
              description="Show notifications on your desktop"
              checked={settings.notifications.desktop}
              onCheckedChange={(checked) =>
                setSettings({
                  ...settings,
                  notifications: { ...settings.notifications, desktop: !!checked }
                })
              }
            />
          </div>
        </div>

        {/* Privacy Section */}
        <div>
          <div className="mb-4 flex items-center gap-2">
            <Eye className="size-5" />
            <h3 className="text-base font-semibold">Privacy</h3>
          </div>
          <div className="flex flex-col gap-4">
            <DescriptionSwitch
              label="Public profile"
              description="Make your profile visible to other users"
              checked={settings.privacy.profile}
              onCheckedChange={(checked) =>
                setSettings({
                  ...settings,
                  privacy: { ...settings.privacy, profile: !!checked }
                })
              }
            />
            <DescriptionSwitch
              label="Activity tracking"
              description="Allow us to track your activity"
              checked={settings.privacy.activity}
              onCheckedChange={(checked) =>
                setSettings({
                  ...settings,
                  privacy: { ...settings.privacy, activity: !!checked }
                })
              }
            />
            <DescriptionSwitch
              label="Analytics"
              description="Help improve the app by sharing usage data"
              checked={settings.privacy.analytics}
              onCheckedChange={(checked) =>
                setSettings({
                  ...settings,
                  privacy: { ...settings.privacy, analytics: !!checked }
                })
              }
            />
          </div>
        </div>

        {/* Features Section */}
        <div>
          <div className="mb-4 flex items-center gap-2">
            <Zap className="size-5" />
            <h3 className="text-base font-semibold">Features</h3>
          </div>
          <div className="flex flex-col gap-4">
            <DescriptionSwitch
              label="Auto-save"
              description="Automatically save your work"
              checked={settings.features.autoSave}
              onCheckedChange={(checked) =>
                setSettings({
                  ...settings,
                  features: { ...settings.features, autoSave: !!checked }
                })
              }
            />
            <DescriptionSwitch
              label="Dark mode"
              description="Use dark theme throughout the app"
              checked={settings.features.darkMode}
              onCheckedChange={(checked) =>
                setSettings({
                  ...settings,
                  features: { ...settings.features, darkMode: !!checked }
                })
              }
            />
            <DescriptionSwitch
              label="Compact view"
              description="Reduce spacing for more content"
              checked={settings.features.compactView}
              onCheckedChange={(checked) =>
                setSettings({
                  ...settings,
                  features: { ...settings.features, compactView: !!checked }
                })
              }
            />
          </div>
        </div>

        {/* Security Section */}
        <div>
          <div className="mb-4 flex items-center gap-2">
            <Lock className="size-5" />
            <h3 className="text-base font-semibold">Security</h3>
          </div>
          <div className="flex flex-col gap-4">
            <DescriptionSwitch
              label="Two-factor authentication"
              description="Require a second verification step when signing in"
              checked={settings.security.twoFactor}
              onCheckedChange={(checked) =>
                setSettings({
                  ...settings,
                  security: { ...settings.security, twoFactor: !!checked }
                })
              }
            />
            <DescriptionSwitch
              label="Biometric authentication"
              description="Use fingerprint or face recognition"
              checked={settings.security.biometric}
              onCheckedChange={(checked) =>
                setSettings({
                  ...settings,
                  security: { ...settings.security, biometric: !!checked }
                })
              }
            />
            <DescriptionSwitch
              label="Auto session timeout"
              description="Automatically sign out after inactivity"
              checked={settings.security.sessionTimeout}
              onCheckedChange={(checked) =>
                setSettings({
                  ...settings,
                  security: { ...settings.security, sessionTimeout: !!checked }
                })
              }
            />
          </div>
        </div>
      </div>
    )
  }
}

// Accessibility Features
export const AccessibilityFeatures: Story = {
  render: () => (
    <div className="w-[500px] space-y-6">
      <div>
        <h3 className="mb-4 text-base font-semibold">Keyboard Navigation</h3>
        <p className="mb-4 text-sm text-muted-foreground">
          Use Tab to navigate between switches and Space/Enter to toggle them. Each switch has a proper label for screen
          readers.
        </p>
        <div className="flex flex-col gap-4">
          <DescriptionSwitch label="High contrast mode" description="Increase contrast for better visibility" />
          <DescriptionSwitch label="Reduce motion" description="Minimize animations and transitions" />
          <DescriptionSwitch
            label="Screen reader optimization"
            description="Optimize interface for screen readers"
            defaultChecked
          />
          <DescriptionSwitch label="Large text" description="Increase font size throughout the app" />
        </div>
      </div>
    </div>
  )
}

// Responsive Layout
export const ResponsiveLayout: Story = {
  render: () => (
    <div className="space-y-6">
      <div className="w-[300px]">
        <h3 className="mb-4 text-sm font-semibold">Narrow Layout (300px)</h3>
        <div className="flex flex-col gap-3">
          <DescriptionSwitch label="Notifications" description="Receive important alerts" size="sm" />
          <DescriptionSwitch label="Auto-save" description="Save automatically" size="sm" defaultChecked />
        </div>
      </div>

      <div className="w-[500px]">
        <h3 className="mb-4 text-sm font-semibold">Standard Layout (500px)</h3>
        <div className="flex flex-col gap-4">
          <DescriptionSwitch label="Notifications" description="Receive alerts for important updates and messages" />
          <DescriptionSwitch label="Auto-save" description="Automatically save your work as you type" defaultChecked />
        </div>
      </div>

      <div className="w-[700px]">
        <h3 className="mb-4 text-sm font-semibold">Wide Layout (700px)</h3>
        <div className="flex flex-col gap-4">
          <DescriptionSwitch
            label="Notifications"
            description="Receive alerts for important updates, messages, and system notifications to stay informed"
            size="lg"
          />
          <DescriptionSwitch
            label="Auto-save"
            description="Automatically save your work as you type to prevent data loss and ensure your progress is always preserved"
            size="lg"
            defaultChecked
          />
        </div>
      </div>
    </div>
  )
}
