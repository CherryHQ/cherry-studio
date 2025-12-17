import { Checkbox, type CheckedState } from '@cherrystudio/ui'
import type { Meta, StoryObj } from '@storybook/react'
import { Bell, Check, FileText, Mail, Shield, Star } from 'lucide-react'
import { useState } from 'react'

const meta: Meta<typeof Checkbox> = {
  title: 'Components/Primitives/Checkbox',
  component: Checkbox,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'A checkbox component based on Radix UI, allowing users to select multiple options. Supports three sizes (sm, md, lg) as defined in the Figma design system.'
      }
    }
  },
  tags: ['autodocs'],
  argTypes: {
    disabled: {
      control: { type: 'boolean' },
      description: 'Whether the checkbox is disabled'
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
        <Checkbox id="default1" />
        <label htmlFor="default1" className="cursor-pointer text-sm">
          Accept terms and conditions
        </label>
      </div>
      <div className="flex items-center gap-2">
        <Checkbox id="default2" />
        <label htmlFor="default2" className="cursor-pointer text-sm">
          Subscribe to newsletter
        </label>
      </div>
      <div className="flex items-center gap-2">
        <Checkbox id="default3" />
        <label htmlFor="default3" className="cursor-pointer text-sm">
          Enable notifications
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
        <Checkbox id="checked1" defaultChecked />
        <label htmlFor="checked1" className="cursor-pointer text-sm">
          Option 1 (Default Checked)
        </label>
      </div>
      <div className="flex items-center gap-2">
        <Checkbox id="checked2" />
        <label htmlFor="checked2" className="cursor-pointer text-sm">
          Option 2
        </label>
      </div>
      <div className="flex items-center gap-2">
        <Checkbox id="checked3" defaultChecked />
        <label htmlFor="checked3" className="cursor-pointer text-sm">
          Option 3 (Default Checked)
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
        <Checkbox id="disabled1" disabled />
        <label htmlFor="disabled1" className="cursor-not-allowed text-sm opacity-50">
          Disabled (Unchecked)
        </label>
      </div>
      <div className="flex items-center gap-2">
        <Checkbox id="disabled2" disabled defaultChecked />
        <label htmlFor="disabled2" className="cursor-not-allowed text-sm opacity-50">
          Disabled (Checked)
        </label>
      </div>
    </div>
  )
}

// Controlled
export const Controlled: Story = {
  render: function ControlledExample() {
    const [checked, setChecked] = useState<CheckedState>(false)

    return (
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-2">
          <Checkbox id="controlled" checked={checked} onCheckedChange={setChecked} />
          <label htmlFor="controlled" className="cursor-pointer text-sm">
            Controlled checkbox
          </label>
        </div>
        <div className="text-sm text-muted-foreground">Current state: {checked ? 'Checked' : 'Unchecked'}</div>
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
            <Checkbox id="size-sm-1" size="sm" />
            <label htmlFor="size-sm-1" className="cursor-pointer text-sm">
              Small checkbox
            </label>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox id="size-sm-2" size="sm" defaultChecked />
            <label htmlFor="size-sm-2" className="cursor-pointer text-sm">
              Small checkbox (checked)
            </label>
          </div>
        </div>
      </div>

      <div>
        <p className="mb-3 text-sm text-muted-foreground">Medium (md) - Default</p>
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <Checkbox id="size-md-1" size="md" />
            <label htmlFor="size-md-1" className="cursor-pointer text-sm">
              Medium checkbox
            </label>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox id="size-md-2" size="md" defaultChecked />
            <label htmlFor="size-md-2" className="cursor-pointer text-sm">
              Medium checkbox (checked)
            </label>
          </div>
        </div>
      </div>

      <div>
        <p className="mb-3 text-sm text-muted-foreground">Large (lg)</p>
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <Checkbox id="size-lg-1" size="lg" />
            <label htmlFor="size-lg-1" className="cursor-pointer text-sm">
              Large checkbox
            </label>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox id="size-lg-2" size="lg" defaultChecked />
            <label htmlFor="size-lg-2" className="cursor-pointer text-sm">
              Large checkbox (checked)
            </label>
          </div>
        </div>
      </div>
    </div>
  )
}

// All States
export const AllStates: Story = {
  render: function AllStatesExample() {
    const [normalChecked, setNormalChecked] = useState<CheckedState>(false)
    const [checkedState, setCheckedState] = useState<CheckedState>(true)

    return (
      <div className="flex flex-col gap-6">
        {/* Normal State (Unchecked) */}
        <div>
          <p className="mb-2 text-sm text-muted-foreground">Normal State (Unchecked)</p>
          <div className="flex items-center gap-2">
            <Checkbox id="state-normal" checked={normalChecked} onCheckedChange={setNormalChecked} />
            <label htmlFor="state-normal" className="cursor-pointer text-sm">
              Unchecked Option
            </label>
          </div>
        </div>

        {/* Checked State */}
        <div>
          <p className="mb-2 text-sm text-muted-foreground">Checked State</p>
          <div className="flex items-center gap-2">
            <Checkbox id="state-checked" checked={checkedState} onCheckedChange={setCheckedState} />
            <label htmlFor="state-checked" className="cursor-pointer text-sm">
              Checked Option
            </label>
          </div>
        </div>

        {/* Disabled State (Unchecked) */}
        <div>
          <p className="mb-2 text-sm text-muted-foreground">Disabled State (Unchecked)</p>
          <div className="flex items-center gap-2">
            <Checkbox id="state-disabled-unchecked" disabled />
            <label htmlFor="state-disabled-unchecked" className="cursor-not-allowed text-sm opacity-50">
              Disabled (Unchecked)
            </label>
          </div>
        </div>

        {/* Disabled State (Checked) */}
        <div>
          <p className="mb-2 text-sm text-muted-foreground">Disabled State (Checked)</p>
          <div className="flex items-center gap-2">
            <Checkbox id="state-disabled-checked" disabled defaultChecked />
            <label htmlFor="state-disabled-checked" className="cursor-not-allowed text-sm opacity-50">
              Disabled (Checked)
            </label>
          </div>
        </div>

        {/* Error State */}
        <div>
          <p className="mb-2 text-sm text-muted-foreground">Error State</p>
          <div className="flex items-center gap-2">
            <Checkbox id="state-error" aria-invalid />
            <label htmlFor="state-error" className="cursor-pointer text-sm">
              Required Field
            </label>
          </div>
          <p className="mt-1 text-xs text-destructive">This field is required</p>
        </div>
      </div>
    )
  }
}

// Real World Examples
export const RealWorldExamples: Story = {
  render: function RealWorldExample() {
    const [settings, setSettings] = useState({
      emailNotifications: true,
      pushNotifications: false,
      smsNotifications: false,
      newsletter: true
    })

    const [features, setFeatures] = useState({
      analytics: true,
      backup: false,
      security: true,
      api: false
    })

    return (
      <div className="flex flex-col gap-8">
        {/* Notification Settings */}
        <div>
          <h3 className="mb-3 text-sm font-semibold">Notification Preferences</h3>
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <Checkbox
                id="notif-email"
                checked={settings.emailNotifications}
                onCheckedChange={(checked) => setSettings({ ...settings, emailNotifications: !!checked })}
              />
              <label htmlFor="notif-email" className="flex cursor-pointer items-center gap-2 text-sm">
                <Mail className="size-4" />
                Email Notifications
              </label>
            </div>
            <div className="flex items-center gap-3">
              <Checkbox
                id="notif-push"
                checked={settings.pushNotifications}
                onCheckedChange={(checked) => setSettings({ ...settings, pushNotifications: !!checked })}
              />
              <label htmlFor="notif-push" className="flex cursor-pointer items-center gap-2 text-sm">
                <Bell className="size-4" />
                Push Notifications
              </label>
            </div>
            <div className="flex items-center gap-3">
              <Checkbox
                id="notif-sms"
                checked={settings.smsNotifications}
                onCheckedChange={(checked) => setSettings({ ...settings, smsNotifications: !!checked })}
              />
              <label htmlFor="notif-sms" className="flex cursor-pointer items-center gap-2 text-sm">
                <FileText className="size-4" />
                SMS Notifications
              </label>
            </div>
            <div className="flex items-center gap-3">
              <Checkbox
                id="notif-newsletter"
                checked={settings.newsletter}
                onCheckedChange={(checked) => setSettings({ ...settings, newsletter: !!checked })}
              />
              <label htmlFor="notif-newsletter" className="flex cursor-pointer items-center gap-2 text-sm">
                <Star className="size-4" />
                Newsletter Subscription
              </label>
            </div>
          </div>
        </div>

        {/* Feature Toggles */}
        <div>
          <h3 className="mb-3 text-sm font-semibold">Feature Toggles</h3>
          <div className="flex flex-col gap-3">
            <div className="flex items-start gap-3">
              <Checkbox
                id="feature-analytics"
                checked={features.analytics}
                onCheckedChange={(checked) => setFeatures({ ...features, analytics: !!checked })}
                className="mt-1"
              />
              <label htmlFor="feature-analytics" className="cursor-pointer">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Check className="size-4" />
                  Analytics
                </div>
                <div className="text-xs text-muted-foreground">Track user behavior and app performance</div>
              </label>
            </div>
            <div className="flex items-start gap-3">
              <Checkbox
                id="feature-backup"
                checked={features.backup}
                onCheckedChange={(checked) => setFeatures({ ...features, backup: !!checked })}
                className="mt-1"
              />
              <label htmlFor="feature-backup" className="cursor-pointer">
                <div className="text-sm font-medium">Automatic Backup</div>
                <div className="text-xs text-muted-foreground">Backup data every 24 hours</div>
              </label>
            </div>
            <div className="flex items-start gap-3">
              <Checkbox
                id="feature-security"
                checked={features.security}
                onCheckedChange={(checked) => setFeatures({ ...features, security: !!checked })}
                className="mt-1"
              />
              <label htmlFor="feature-security" className="cursor-pointer">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Shield className="size-4" />
                  Advanced Security
                </div>
                <div className="text-xs text-muted-foreground">Enable two-factor authentication</div>
              </label>
            </div>
            <div className="flex items-start gap-3">
              <Checkbox
                id="feature-api"
                checked={features.api}
                onCheckedChange={(checked) => setFeatures({ ...features, api: !!checked })}
                className="mt-1"
              />
              <label htmlFor="feature-api" className="cursor-pointer">
                <div className="text-sm font-medium">API Access</div>
                <div className="text-xs text-muted-foreground">Enable programmatic access</div>
              </label>
            </div>
          </div>
        </div>

        {/* Required Agreement */}
        <div>
          <h3 className="mb-3 text-sm font-semibold">
            Terms and Conditions <span className="text-destructive">*</span>
          </h3>
          <div className="flex items-center gap-2">
            <Checkbox id="terms" aria-invalid />
            <label htmlFor="terms" className="cursor-pointer text-sm">
              I agree to the terms and conditions
            </label>
          </div>
          <p className="mt-1 text-xs text-destructive">You must accept the terms and conditions to continue</p>
        </div>
      </div>
    )
  }
}

// Size Comparison
export const SizeComparison: Story = {
  render: () => (
    <div className="flex items-center gap-6">
      <div className="flex flex-col gap-4">
        <p className="text-xs font-medium text-muted-foreground">Unchecked</p>
        <div className="flex items-center gap-4">
          <div className="flex flex-col items-center gap-2">
            <Checkbox id="compare-sm-1" size="sm" />
            <span className="text-xs text-muted-foreground">sm</span>
          </div>
          <div className="flex flex-col items-center gap-2">
            <Checkbox id="compare-md-1" size="md" />
            <span className="text-xs text-muted-foreground">md</span>
          </div>
          <div className="flex flex-col items-center gap-2">
            <Checkbox id="compare-lg-1" size="lg" />
            <span className="text-xs text-muted-foreground">lg</span>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-4">
        <p className="text-xs font-medium text-muted-foreground">Checked</p>
        <div className="flex items-center gap-4">
          <div className="flex flex-col items-center gap-2">
            <Checkbox id="compare-sm-2" size="sm" defaultChecked />
            <span className="text-xs text-muted-foreground">sm</span>
          </div>
          <div className="flex flex-col items-center gap-2">
            <Checkbox id="compare-md-2" size="md" defaultChecked />
            <span className="text-xs text-muted-foreground">md</span>
          </div>
          <div className="flex flex-col items-center gap-2">
            <Checkbox id="compare-lg-2" size="lg" defaultChecked />
            <span className="text-xs text-muted-foreground">lg</span>
          </div>
        </div>
      </div>
    </div>
  )
}

// Form Example
export const FormExample: Story = {
  render: function FormExample() {
    const [formData, setFormData] = useState({
      terms: false,
      privacy: false,
      marketing: false
    })

    const [submitted, setSubmitted] = useState(false)

    const handleSubmit = (e: React.FormEvent) => {
      e.preventDefault()
      setSubmitted(true)
    }

    return (
      <form onSubmit={handleSubmit} className="w-80 space-y-4">
        <h3 className="text-sm font-semibold">Account Registration</h3>

        <div className="space-y-3">
          <div className="flex items-start gap-2">
            <Checkbox
              id="form-terms"
              checked={formData.terms}
              onCheckedChange={(checked) => setFormData({ ...formData, terms: !!checked })}
              aria-invalid={submitted && !formData.terms}
              className="mt-0.5"
            />
            <label htmlFor="form-terms" className="cursor-pointer text-sm leading-relaxed">
              I agree to the{' '}
              <a href="#" className="text-primary hover:underline">
                Terms of Service
              </a>{' '}
              <span className="text-destructive">*</span>
            </label>
          </div>
          {submitted && !formData.terms && <p className="text-xs text-destructive">This field is required</p>}

          <div className="flex items-start gap-2">
            <Checkbox
              id="form-privacy"
              checked={formData.privacy}
              onCheckedChange={(checked) => setFormData({ ...formData, privacy: !!checked })}
              aria-invalid={submitted && !formData.privacy}
              className="mt-0.5"
            />
            <label htmlFor="form-privacy" className="cursor-pointer text-sm leading-relaxed">
              I acknowledge the{' '}
              <a href="#" className="text-primary hover:underline">
                Privacy Policy
              </a>{' '}
              <span className="text-destructive">*</span>
            </label>
          </div>
          {submitted && !formData.privacy && <p className="text-xs text-destructive">This field is required</p>}

          <div className="flex items-start gap-2">
            <Checkbox
              id="form-marketing"
              checked={formData.marketing}
              onCheckedChange={(checked) => setFormData({ ...formData, marketing: !!checked })}
              className="mt-0.5"
            />
            <label htmlFor="form-marketing" className="cursor-pointer text-sm leading-relaxed">
              I want to receive marketing emails and promotional offers
            </label>
          </div>
        </div>

        <button
          type="submit"
          className="w-full rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90">
          Register
        </button>

        {submitted && formData.terms && formData.privacy && (
          <p className="text-sm text-green-600">Registration successful!</p>
        )}
      </form>
    )
  }
}
