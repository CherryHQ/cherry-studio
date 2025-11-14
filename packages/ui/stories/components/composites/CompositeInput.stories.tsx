import type { Meta, StoryObj } from '@storybook/react'
import { Send } from 'lucide-react'
import { useState } from 'react'

import { CompositeInput } from '../../../src/components/composites/Input'

const meta: Meta<typeof CompositeInput> = {
  title: 'Components/Composites/CompositeInput',
  component: CompositeInput,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'A composite input component built on top of InputGroup. Provides pre-configured layouts with icons and optional action buttons. Features automatic password visibility toggle and supports multiple sizes and variants for different use cases.'
      }
    }
  },
  tags: ['autodocs'],
  argTypes: {
    type: {
      control: { type: 'select' },
      options: ['text', 'email', 'password', 'number'],
      description: 'The type of the input'
    },
    variant: {
      control: { type: 'select' },
      options: ['default', 'button', 'email', 'select'],
      description: 'The visual variant of the input'
    },
    size: {
      control: { type: 'select' },
      options: ['sm', 'md', 'lg'],
      description: 'The size of the input'
    },
    disabled: {
      control: { type: 'boolean' },
      description: 'Whether the input is disabled'
    },
    placeholder: {
      control: { type: 'text' },
      description: 'Placeholder text'
    }
  }
}

export default meta
type Story = StoryObj<typeof meta>

// Basic Variants
export const Default: Story = {
  args: {
    variant: 'default',
    placeholder: 'Enter text...'
  },
  render: (args) => (
    <div className="w-80">
      <CompositeInput {...args} />
    </div>
  )
}

export const DefaultWithValue: Story = {
  args: {
    variant: 'default',
    defaultValue: 'Hello World',
    placeholder: 'Enter text...'
  },
  render: (args) => (
    <div className="w-80">
      <CompositeInput {...args} />
    </div>
  )
}

export const EmailVariant: Story = {
  render: () => (
    <div className="w-80">
      <CompositeInput variant="email" type="email" placeholder="example.com" prefix="user@" />
    </div>
  )
}

export const EmailVariantExamples: Story = {
  render: () => (
    <div className="flex w-96 flex-col gap-6">
      <div>
        <p className="mb-2 text-sm text-muted-foreground">Email with @domain prefix</p>
        <CompositeInput variant="email" type="email" placeholder="example.com" prefix="user@" />
      </div>

      <div>
        <p className="mb-2 text-sm text-muted-foreground">Email with custom prefix</p>
        <CompositeInput variant="email" type="email" placeholder="email.com" prefix="contact@" />
      </div>

      <div>
        <p className="mb-2 text-sm text-muted-foreground">Email with company domain</p>
        <CompositeInput variant="email" type="email" placeholder="company.com" prefix="admin@" />
      </div>

      <div>
        <p className="mb-2 text-sm text-muted-foreground">Email with value</p>
        <CompositeInput
          variant="email"
          type="email"
          placeholder="example.com"
          prefix="john@"
          defaultValue="example.com"
        />
      </div>
    </div>
  )
}

export const ButtonVariant: Story = {
  render: () => (
    <div className="w-80">
      <CompositeInput
        variant="button"
        placeholder="Enter email..."
        buttonProps={{
          label: 'Subscribe',
          onClick: () => alert('Subscribed!')
        }}
      />
    </div>
  )
}

export const SelectVariant: Story = {
  render: () => (
    <div className="w-80">
      <CompositeInput
        variant="select"
        placeholder="Enter amount..."
        selectProps={{
          placeholder: 'Currency',
          groups: [
            {
              label: 'Popular',
              items: [
                { label: 'USD', value: 'usd' },
                { label: 'EUR', value: 'eur' },
                { label: 'GBP', value: 'gbp' }
              ]
            }
          ]
        }}
      />
    </div>
  )
}

export const SelectVariantExamples: Story = {
  render: () => (
    <div className="flex w-96 flex-col gap-6">
      <div>
        <p className="mb-2 text-sm text-muted-foreground">Currency Input</p>
        <CompositeInput
          variant="select"
          placeholder="0.00"
          type="number"
          selectProps={{
            placeholder: 'Currency',
            groups: [
              {
                label: 'Popular',
                items: [
                  { label: 'USD', value: 'usd' },
                  { label: 'EUR', value: 'eur' },
                  { label: 'GBP', value: 'gbp' }
                ]
              },
              {
                label: 'Other',
                items: [
                  { label: 'JPY', value: 'jpy' },
                  { label: 'CNY', value: 'cny' },
                  { label: 'AUD', value: 'aud' }
                ]
              }
            ]
          }}
        />
      </div>

      <div>
        <p className="mb-2 text-sm text-muted-foreground">URL with Protocol</p>
        <CompositeInput
          variant="select"
          placeholder="example.com"
          selectProps={{
            placeholder: 'Protocol',
            groups: [
              {
                label: 'Protocol',
                items: [
                  { label: 'https://', value: 'https' },
                  { label: 'http://', value: 'http' },
                  { label: 'ftp://', value: 'ftp' }
                ]
              }
            ]
          }}
        />
      </div>

      <div>
        <p className="mb-2 text-sm text-muted-foreground">Phone with Country Code</p>
        <CompositeInput
          variant="select"
          placeholder="123-456-7890"
          type="tel"
          selectProps={{
            placeholder: 'Code',
            groups: [
              {
                label: 'Countries',
                items: [
                  { label: '+1', value: 'us' },
                  { label: '+44', value: 'uk' },
                  { label: '+86', value: 'cn' },
                  { label: '+81', value: 'jp' }
                ]
              }
            ]
          }}
        />
      </div>

      <div>
        <p className="mb-2 text-sm text-muted-foreground">Temperature with Unit</p>
        <CompositeInput
          variant="select"
          placeholder="0"
          type="number"
          selectProps={{
            placeholder: 'Unit',
            groups: [
              {
                label: 'Temperature',
                items: [
                  { label: '°C', value: 'celsius' },
                  { label: '°F', value: 'fahrenheit' },
                  { label: 'K', value: 'kelvin' }
                ]
              }
            ]
          }}
        />
      </div>
    </div>
  )
}

// Password Input with Toggle
export const PasswordDefault: Story = {
  args: {
    variant: 'default',
    type: 'password',
    placeholder: 'Enter password...'
  },
  render: (args) => (
    <div className="w-80">
      <CompositeInput {...args} />
      <p className="mt-2 text-xs text-muted-foreground">Click the eye icon to toggle password visibility</p>
    </div>
  )
}

export const PasswordWithButton: Story = {
  render: () => (
    <div className="w-80">
      <CompositeInput
        variant="button"
        type="password"
        placeholder="Enter password..."
        buttonProps={{
          label: 'Reset',
          onClick: () => alert('Password reset requested')
        }}
      />
      <p className="mt-2 text-xs text-muted-foreground">Password field with action button and visibility toggle</p>
    </div>
  )
}

// Sizes
export const Sizes: Story = {
  render: () => (
    <div className="flex w-96 flex-col gap-6">
      <div>
        <p className="mb-2 text-sm text-muted-foreground">Small (sm)</p>
        <CompositeInput variant="default" size="sm" placeholder="Small input..." />
      </div>

      <div>
        <p className="mb-2 text-sm text-muted-foreground">Medium (md) - Default</p>
        <CompositeInput variant="default" size="md" placeholder="Medium input..." />
      </div>

      <div>
        <p className="mb-2 text-sm text-muted-foreground">Large (lg)</p>
        <CompositeInput variant="default" size="lg" placeholder="Large input..." />
      </div>
    </div>
  )
}

export const SizesWithButton: Story = {
  render: () => (
    <div className="flex w-96 flex-col gap-6">
      <div>
        <p className="mb-2 text-sm text-muted-foreground">Small (sm) with Button</p>
        <CompositeInput
          variant="button"
          size="sm"
          placeholder="Small input..."
          buttonProps={{
            label: 'Go',
            onClick: () => {}
          }}
        />
      </div>

      <div>
        <p className="mb-2 text-sm text-muted-foreground">Medium (md) with Button - Default</p>
        <CompositeInput
          variant="button"
          size="md"
          placeholder="Medium input..."
          buttonProps={{
            label: 'Submit',
            onClick: () => {}
          }}
        />
      </div>

      <div>
        <p className="mb-2 text-sm text-muted-foreground">Large (lg) with Button</p>
        <CompositeInput
          variant="button"
          size="lg"
          placeholder="Large input..."
          buttonProps={{
            label: 'Send',
            onClick: () => {}
          }}
        />
      </div>
    </div>
  )
}

// Select Sizes
export const SelectVariantSizes: Story = {
  render: () => (
    <div className="flex w-96 flex-col gap-6">
      <div>
        <p className="mb-2 text-sm text-muted-foreground">Small (sm)</p>
        <CompositeInput
          variant="select"
          size="sm"
          placeholder="0.00"
          type="number"
          selectProps={{
            placeholder: 'USD',
            groups: [
              {
                label: 'Currency',
                items: [
                  { label: 'USD', value: 'usd' },
                  { label: 'EUR', value: 'eur' },
                  { label: 'GBP', value: 'gbp' }
                ]
              }
            ]
          }}
        />
      </div>

      <div>
        <p className="mb-2 text-sm text-muted-foreground">Medium (md) - Default</p>
        <CompositeInput
          variant="select"
          size="md"
          placeholder="0.00"
          type="number"
          selectProps={{
            placeholder: 'USD',
            groups: [
              {
                label: 'Currency',
                items: [
                  { label: 'USD', value: 'usd' },
                  { label: 'EUR', value: 'eur' },
                  { label: 'GBP', value: 'gbp' }
                ]
              }
            ]
          }}
        />
      </div>

      <div>
        <p className="mb-2 text-sm text-muted-foreground">Large (lg)</p>
        <CompositeInput
          variant="select"
          size="lg"
          placeholder="0.00"
          type="number"
          selectProps={{
            placeholder: 'USD',
            groups: [
              {
                label: 'Currency',
                items: [
                  { label: 'USD', value: 'usd' },
                  { label: 'EUR', value: 'eur' },
                  { label: 'GBP', value: 'gbp' }
                ]
              }
            ]
          }}
        />
      </div>
    </div>
  )
}

export const SelectVariantInteractive: Story = {
  render: function SelectVariantInteractiveExample() {
    const [amount, setAmount] = useState('')
    const [currency, setCurrency] = useState('usd')
    const [converted, setConverted] = useState<{ value: number; currency: string } | null>(null)

    // Mock exchange rates
    const rates: Record<string, number> = {
      usd: 1,
      eur: 0.92,
      gbp: 0.79,
      jpy: 149.5,
      cny: 7.24,
      aud: 1.52
    }

    const handleConvert = () => {
      const numAmount = parseFloat(amount)
      if (!isNaN(numAmount) && numAmount > 0) {
        const convertedValue = numAmount * rates[currency]
        setConverted({ value: convertedValue, currency })
      }
    }

    return (
      <div className="w-96 space-y-4">
        <h3 className="text-base font-semibold">Currency Converter</h3>
        <div>
          <label className="mb-1 block text-sm font-medium">Amount in USD</label>
          <CompositeInput
            variant="select"
            placeholder="0.00"
            type="number"
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value)
              setConverted(null)
            }}
            selectProps={{
              placeholder: 'Currency',
              groups: [
                {
                  label: 'Popular',
                  items: [
                    { label: 'USD', value: 'usd' },
                    { label: 'EUR', value: 'eur' },
                    { label: 'GBP', value: 'gbp' }
                  ]
                },
                {
                  label: 'Other',
                  items: [
                    { label: 'JPY', value: 'jpy' },
                    { label: 'CNY', value: 'cny' },
                    { label: 'AUD', value: 'aud' }
                  ]
                }
              ]
            }}
          />
          {amount && !converted && (
            <p className="mt-1 text-xs text-muted-foreground">Enter amount to convert to selected currency</p>
          )}
        </div>

        <button
          type="button"
          onClick={handleConvert}
          disabled={!amount || parseFloat(amount) <= 0}
          className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
          Convert
        </button>

        {converted && (
          <div className="rounded-md border bg-muted/20 p-4">
            <p className="text-sm font-medium">Converted Amount</p>
            <p className="mt-1 text-2xl font-semibold">
              {converted.value.toFixed(2)} {converted.currency.toUpperCase()}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {amount} USD = {converted.value.toFixed(2)} {converted.currency.toUpperCase()}
            </p>
          </div>
        )}
      </div>
    )
  }
}

// All Variants
export const AllVariants: Story = {
  render: () => (
    <div className="flex w-96 flex-col gap-6">
      <div>
        <p className="mb-2 text-sm text-muted-foreground">Default Variant</p>
        <CompositeInput variant="default" placeholder="Default variant..." />
      </div>

      <div>
        <p className="mb-2 text-sm text-muted-foreground">Email Variant</p>
        <CompositeInput variant="email" type="email" placeholder="example.com" prefix="user@" />
      </div>

      <div>
        <p className="mb-2 text-sm text-muted-foreground">Select Variant</p>
        <CompositeInput
          variant="select"
          placeholder="0.00"
          type="number"
          selectProps={{
            placeholder: 'Currency',
            groups: [
              {
                label: 'Popular',
                items: [
                  { label: 'USD', value: 'usd' },
                  { label: 'EUR', value: 'eur' }
                ]
              }
            ]
          }}
        />
      </div>

      <div>
        <p className="mb-2 text-sm text-muted-foreground">Button Variant</p>
        <CompositeInput
          variant="button"
          placeholder="Enter text..."
          buttonProps={{
            label: 'Submit',
            onClick: () => {}
          }}
        />
      </div>

      <div>
        <p className="mb-2 text-sm text-muted-foreground">Password (Default Variant)</p>
        <CompositeInput variant="default" type="password" placeholder="Enter password..." />
      </div>

      <div>
        <p className="mb-2 text-sm text-muted-foreground">Password (Button Variant)</p>
        <CompositeInput
          variant="button"
          type="password"
          placeholder="Enter password..."
          buttonProps={{
            label: 'Reset',
            onClick: () => {}
          }}
        />
      </div>
    </div>
  )
}

// Email Sizes
export const EmailVariantSizes: Story = {
  render: () => (
    <div className="flex w-96 flex-col gap-6">
      <div>
        <p className="mb-2 text-sm text-muted-foreground">Small (sm)</p>
        <CompositeInput variant="email" type="email" size="sm" placeholder="example.com" prefix="user@" />
      </div>

      <div>
        <p className="mb-2 text-sm text-muted-foreground">Medium (md) - Default</p>
        <CompositeInput variant="email" type="email" size="md" placeholder="example.com" prefix="user@" />
      </div>

      <div>
        <p className="mb-2 text-sm text-muted-foreground">Large (lg)</p>
        <CompositeInput variant="email" type="email" size="lg" placeholder="example.com" prefix="user@" />
      </div>
    </div>
  )
}

// States
export const DisabledState: Story = {
  render: () => (
    <div className="flex w-96 flex-col gap-4">
      <div>
        <p className="mb-2 text-sm text-muted-foreground">Disabled - Default Variant</p>
        <CompositeInput variant="default" placeholder="Disabled input" disabled defaultValue="Cannot edit" />
      </div>

      <div>
        <p className="mb-2 text-sm text-muted-foreground">Disabled - Email Variant</p>
        <CompositeInput
          variant="email"
          type="email"
          placeholder="example.com"
          prefix="user@"
          disabled
          defaultValue="example.com"
        />
      </div>

      <div>
        <p className="mb-2 text-sm text-muted-foreground">Disabled - Select Variant</p>
        <CompositeInput
          variant="select"
          placeholder="0.00"
          type="number"
          disabled
          defaultValue="100.00"
          selectProps={{
            placeholder: 'USD',
            groups: [
              {
                label: 'Currency',
                items: [
                  { label: 'USD', value: 'usd' },
                  { label: 'EUR', value: 'eur' }
                ]
              }
            ]
          }}
        />
      </div>

      <div>
        <p className="mb-2 text-sm text-muted-foreground">Disabled - Button Variant</p>
        <CompositeInput
          variant="button"
          placeholder="Disabled input"
          disabled
          buttonProps={{
            label: 'Submit',
            onClick: () => {}
          }}
        />
      </div>
    </div>
  )
}

export const DisabledPassword: Story = {
  render: () => (
    <div className="flex w-96 flex-col gap-4">
      <div>
        <p className="mb-2 text-sm text-muted-foreground">Disabled Password - Default Variant</p>
        <CompositeInput
          variant="default"
          type="password"
          placeholder="Disabled password"
          disabled
          defaultValue="secret123"
        />
        <p className="mt-1 text-xs text-muted-foreground">
          Password field is disabled, eye icon still visible but non-functional
        </p>
      </div>

      <div>
        <p className="mb-2 text-sm text-muted-foreground">Disabled Password - Button Variant</p>
        <CompositeInput
          variant="button"
          type="password"
          placeholder="Disabled password"
          disabled
          defaultValue="mypassword"
          buttonProps={{
            label: 'Reset',
            onClick: () => {}
          }}
        />
        <p className="mt-1 text-xs text-muted-foreground">Both input and button are disabled</p>
      </div>

      <div>
        <p className="mb-2 text-sm text-muted-foreground">Disabled Password - Empty</p>
        <CompositeInput variant="default" type="password" placeholder="Enter password..." disabled />
      </div>
    </div>
  )
}

export const ValidationError: Story = {
  render: () => (
    <div className="flex w-96 flex-col gap-6">
      <div>
        <p className="mb-2 text-sm text-muted-foreground">Invalid Email - Default Variant</p>
        <CompositeInput
          variant="default"
          type="email"
          placeholder="email@example.com"
          defaultValue="invalid-email"
          aria-invalid
        />
        <p className="mt-1 text-xs text-destructive">Please enter a valid email address</p>
      </div>

      <div>
        <p className="mb-2 text-sm text-muted-foreground">Invalid Email - Email Variant</p>
        <CompositeInput
          variant="email"
          type="email"
          placeholder="example.com"
          prefix="user@"
          defaultValue="invalid domain"
          aria-invalid
        />
        <p className="mt-1 text-xs text-destructive">Email format is incorrect</p>
      </div>

      <div>
        <p className="mb-2 text-sm text-muted-foreground">Invalid Email - Button Variant</p>
        <CompositeInput
          variant="button"
          type="email"
          placeholder="Enter your email..."
          defaultValue="bad@email"
          aria-invalid
          buttonProps={{
            label: 'Subscribe',
            onClick: () => {}
          }}
        />
        <p className="mt-1 text-xs text-destructive">Please provide a complete email address</p>
      </div>

      <div>
        <p className="mb-2 text-sm text-muted-foreground">Invalid Password - Too Short</p>
        <CompositeInput
          variant="default"
          type="password"
          placeholder="Enter password..."
          defaultValue="123"
          aria-invalid
        />
        <p className="mt-1 text-xs text-destructive">Password must be at least 8 characters long</p>
      </div>

      <div>
        <p className="mb-2 text-sm text-muted-foreground">Required Field - Empty</p>
        <CompositeInput variant="default" placeholder="This field is required" aria-invalid />
        <p className="mt-1 text-xs text-destructive">This field is required</p>
      </div>
    </div>
  )
}

export const EmailVariantInteractive: Story = {
  render: function EmailVariantInteractiveExample() {
    const [domain, setDomain] = useState('')
    const [error, setError] = useState('')

    const validateDomain = (value: string) => {
      if (!value) {
        setError('Domain is required')
        return false
      }
      // Simple domain validation
      const domainRegex = /^[a-zA-Z0-9][a-zA-Z0-9-]{0,61}[a-zA-Z0-9]?\.[a-zA-Z]{2,}$/
      if (!domainRegex.test(value)) {
        setError('Please enter a valid domain (e.g., example.com)')
        return false
      }
      setError('')
      return true
    }

    const handleSubmit = () => {
      if (validateDomain(domain)) {
        alert(`Email created: user@${domain}`)
      }
    }

    return (
      <div className="w-96 space-y-4">
        <h3 className="text-base font-semibold">Create Email Address</h3>
        <div>
          <label className="mb-1 block text-sm font-medium">Email Domain</label>
          <CompositeInput
            variant="email"
            type="email"
            placeholder="example.com"
            prefix="user@"
            value={domain}
            onChange={(e) => {
              setDomain(e.target.value)
              if (error) validateDomain(e.target.value)
            }}
            onBlur={() => validateDomain(domain)}
            aria-invalid={!!error}
          />
          {error ? (
            <p className="mt-1 text-xs text-destructive">{error}</p>
          ) : domain ? (
            <p className="mt-1 text-xs text-green-600">✓ Valid email: user@{domain}</p>
          ) : (
            <p className="mt-1 text-xs text-muted-foreground">Enter the domain for your email address</p>
          )}
        </div>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!domain || !!error}
          className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
          Create Email
        </button>
      </div>
    )
  }
}

export const ValidationForm: Story = {
  render: function ValidationFormExample() {
    const [formData, setFormData] = useState({
      email: '',
      password: '',
      confirmPassword: ''
    })
    const [errors, setErrors] = useState<Record<string, string>>({})
    const [touched, setTouched] = useState<Record<string, boolean>>({})

    const validateEmail = (email: string) => {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
      if (!email) return 'Email is required'
      if (!emailRegex.test(email)) return 'Please enter a valid email address'
      return ''
    }

    const validatePassword = (password: string) => {
      if (!password) return 'Password is required'
      if (password.length < 8) return 'Password must be at least 8 characters'
      return ''
    }

    const validateConfirmPassword = (confirmPassword: string, password: string) => {
      if (!confirmPassword) return 'Please confirm your password'
      if (confirmPassword !== password) return 'Passwords do not match'
      return ''
    }

    const handleBlur = (field: string) => {
      setTouched({ ...touched, [field]: true })

      const newErrors = { ...errors }
      if (field === 'email') {
        const error = validateEmail(formData.email)
        if (error) newErrors.email = error
        else delete newErrors.email
      } else if (field === 'password') {
        const error = validatePassword(formData.password)
        if (error) newErrors.password = error
        else delete newErrors.password
      } else if (field === 'confirmPassword') {
        const error = validateConfirmPassword(formData.confirmPassword, formData.password)
        if (error) newErrors.confirmPassword = error
        else delete newErrors.confirmPassword
      }
      setErrors(newErrors)
    }

    const handleSubmit = (e: React.FormEvent) => {
      e.preventDefault()

      const newErrors: Record<string, string> = {}
      const emailError = validateEmail(formData.email)
      const passwordError = validatePassword(formData.password)
      const confirmError = validateConfirmPassword(formData.confirmPassword, formData.password)

      if (emailError) newErrors.email = emailError
      if (passwordError) newErrors.password = passwordError
      if (confirmError) newErrors.confirmPassword = confirmError

      setErrors(newErrors)
      setTouched({ email: true, password: true, confirmPassword: true })

      if (Object.keys(newErrors).length === 0) {
        alert('Form submitted successfully!')
      }
    }

    return (
      <form onSubmit={handleSubmit} className="w-96 space-y-4">
        <h3 className="text-base font-semibold">Sign Up with Validation</h3>

        <div>
          <label className="mb-1 block text-sm font-medium">
            Email <span className="text-destructive">*</span>
          </label>
          <CompositeInput
            variant="email"
            type="email"
            placeholder="email@example.com"
            value={formData.email}
            onChange={(e) => setFormData({ ...formData, email: e.target.value })}
            onBlur={() => handleBlur('email')}
            aria-invalid={touched.email && !!errors.email}
          />
          {touched.email && errors.email && <p className="mt-1 text-xs text-destructive">{errors.email}</p>}
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium">
            Password <span className="text-destructive">*</span>
          </label>
          <CompositeInput
            variant="default"
            type="password"
            placeholder="Enter password..."
            value={formData.password}
            onChange={(e) => setFormData({ ...formData, password: e.target.value })}
            onBlur={() => handleBlur('password')}
            aria-invalid={touched.password && !!errors.password}
          />
          {touched.password && errors.password && <p className="mt-1 text-xs text-destructive">{errors.password}</p>}
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium">
            Confirm Password <span className="text-destructive">*</span>
          </label>
          <CompositeInput
            variant="default"
            type="password"
            placeholder="Confirm password..."
            value={formData.confirmPassword}
            onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
            onBlur={() => handleBlur('confirmPassword')}
            aria-invalid={touched.confirmPassword && !!errors.confirmPassword}
          />
          {touched.confirmPassword && errors.confirmPassword && (
            <p className="mt-1 text-xs text-destructive">{errors.confirmPassword}</p>
          )}
        </div>

        <button
          type="submit"
          className="w-full rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90">
          Create Account
        </button>

        <p className="text-xs text-muted-foreground">* Fields marked with an asterisk are required</p>
      </form>
    )
  }
}

// Interactive Examples
export const SubscribeNewsletter: Story = {
  render: function SubscribeNewsletterExample() {
    const [email, setEmail] = useState('')
    const [submitted, setSubmitted] = useState(false)

    const handleSubscribe = () => {
      if (email) {
        setSubmitted(true)
        setTimeout(() => {
          setSubmitted(false)
          setEmail('')
        }, 3000)
      }
    }

    return (
      <div className="w-96 space-y-4">
        <h3 className="text-base font-semibold">Subscribe to Newsletter</h3>
        <CompositeInput
          variant="button"
          type="email"
          placeholder="Enter your email..."
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          buttonProps={{
            label: submitted ? 'Subscribed!' : 'Subscribe',
            onClick: handleSubscribe
          }}
          disabled={submitted}
        />
        {submitted && <p className="text-sm text-green-600">Thanks for subscribing!</p>}
      </div>
    )
  }
}

export const SearchWithAction: Story = {
  render: function SearchWithActionExample() {
    const [query, setQuery] = useState('')
    const [results, setResults] = useState<string[]>([])

    const handleSearch = () => {
      if (query) {
        const mockResults = [`Result 1 for "${query}"`, `Result 2 for "${query}"`, `Result 3 for "${query}"`]
        setResults(mockResults)
      }
    }

    return (
      <div className="w-96 space-y-4">
        <h3 className="text-base font-semibold">Search</h3>
        <CompositeInput
          variant="button"
          placeholder="Enter search query..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          buttonProps={{
            label: <Send className="size-4" />,
            onClick: handleSearch
          }}
        />
        {results.length > 0 && (
          <div className="rounded-md border p-3">
            <p className="mb-2 text-sm font-medium">Results ({results.length})</p>
            <ul className="space-y-1">
              {results.map((result, i) => (
                <li key={i} className="text-sm text-muted-foreground">
                  {result}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    )
  }
}

export const PasswordReset: Story = {
  render: function PasswordResetExample() {
    const [password, setPassword] = useState('')
    const [showStrength, setShowStrength] = useState(false)

    const getPasswordStrength = (pwd: string) => {
      if (pwd.length === 0) return { label: '', color: '' }
      if (pwd.length < 6) return { label: 'Weak', color: 'text-red-600' }
      if (pwd.length < 10) return { label: 'Medium', color: 'text-yellow-600' }
      return { label: 'Strong', color: 'text-green-600' }
    }

    const strength = getPasswordStrength(password)

    return (
      <div className="w-96 space-y-4">
        <h3 className="text-base font-semibold">Set New Password</h3>
        <div>
          <CompositeInput
            variant="button"
            type="password"
            placeholder="Enter new password..."
            value={password}
            onChange={(e) => {
              setPassword(e.target.value)
              setShowStrength(e.target.value.length > 0)
            }}
            buttonProps={{
              label: 'Update',
              onClick: () => alert('Password updated!')
            }}
          />
          {showStrength && strength.label && (
            <p className={`mt-2 text-sm ${strength.color}`}>Password strength: {strength.label}</p>
          )}
        </div>
        <p className="text-xs text-muted-foreground">Password must be at least 8 characters long</p>
      </div>
    )
  }
}

// Form Examples
export const LoginForm: Story = {
  render: function LoginFormExample() {
    const [formData, setFormData] = useState({
      email: '',
      password: ''
    })

    const handleSubmit = (e: React.FormEvent) => {
      e.preventDefault()
      alert(`Logging in with: ${formData.email}`)
    }

    return (
      <form onSubmit={handleSubmit} className="w-96 space-y-4">
        <h3 className="text-base font-semibold">Login</h3>

        <div>
          <label className="mb-1 block text-sm font-medium">Email</label>
          <CompositeInput
            variant="email"
            type="email"
            placeholder="email@example.com"
            value={formData.email}
            onChange={(e) => setFormData({ ...formData, email: e.target.value })}
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium">Password</label>
          <CompositeInput
            variant="default"
            type="password"
            placeholder="Enter password..."
            value={formData.password}
            onChange={(e) => setFormData({ ...formData, password: e.target.value })}
          />
        </div>

        <button
          type="submit"
          className="w-full rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90">
          Sign In
        </button>
      </form>
    )
  }
}

export const SignupForm: Story = {
  render: function SignupFormExample() {
    const [formData, setFormData] = useState({
      name: '',
      email: '',
      password: '',
      confirmPassword: ''
    })

    const handleSubmit = (e: React.FormEvent) => {
      e.preventDefault()
      if (formData.password !== formData.confirmPassword) {
        alert('Passwords do not match!')
        return
      }
      alert(`Account created for: ${formData.email}`)
    }

    return (
      <form onSubmit={handleSubmit} className="w-96 space-y-4">
        <h3 className="text-base font-semibold">Create Account</h3>

        <div>
          <label className="mb-1 block text-sm font-medium">Full Name</label>
          <CompositeInput
            variant="default"
            placeholder="John Doe"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium">Email</label>
          <CompositeInput
            variant="email"
            type="email"
            placeholder="email@example.com"
            value={formData.email}
            onChange={(e) => setFormData({ ...formData, email: e.target.value })}
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium">Password</label>
          <CompositeInput
            variant="default"
            type="password"
            placeholder="Enter password..."
            value={formData.password}
            onChange={(e) => setFormData({ ...formData, password: e.target.value })}
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium">Confirm Password</label>
          <CompositeInput
            variant="default"
            type="password"
            placeholder="Confirm password..."
            value={formData.confirmPassword}
            onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
          />
        </div>

        <button
          type="submit"
          className="w-full rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90">
          Sign Up
        </button>
      </form>
    )
  }
}

export const QuickActions: Story = {
  render: () => (
    <div className="flex w-96 flex-col gap-6">
      <div>
        <h3 className="mb-3 text-base font-semibold">Quick Actions</h3>
        <div className="space-y-3">
          <CompositeInput
            variant="button"
            placeholder="Send a message..."
            buttonProps={{
              label: 'Send',
              onClick: () => alert('Message sent!')
            }}
          />

          <CompositeInput
            variant="button"
            type="email"
            placeholder="Invite user by email..."
            buttonProps={{
              label: 'Invite',
              onClick: () => alert('Invitation sent!')
            }}
          />

          <CompositeInput
            variant="button"
            placeholder="Add new item..."
            buttonProps={{
              label: '+ Add',
              onClick: () => alert('Item added!')
            }}
          />
        </div>
      </div>
    </div>
  )
}

// Real World Examples
export const RealWorldExamples: Story = {
  render: () => (
    <div className="flex flex-col gap-8">
      {/* Newsletter Subscription */}
      <div className="w-96">
        <h3 className="mb-2 text-base font-semibold">Stay Updated</h3>
        <p className="mb-3 text-sm text-muted-foreground">Get the latest news and updates delivered to your inbox.</p>
        <CompositeInput
          variant="button"
          type="email"
          placeholder="Enter your email..."
          buttonProps={{
            label: 'Subscribe',
            onClick: () => {}
          }}
        />
      </div>

      {/* Support Ticket */}
      <div className="w-96">
        <h3 className="mb-2 text-base font-semibold">Submit Ticket</h3>
        <p className="mb-3 text-sm text-muted-foreground">Describe your issue and we'll get back to you.</p>
        <CompositeInput
          variant="button"
          placeholder="Describe your issue..."
          buttonProps={{
            label: 'Submit',
            onClick: () => {}
          }}
        />
      </div>

      {/* Promo Code */}
      <div className="w-96">
        <h3 className="mb-2 text-base font-semibold">Have a Promo Code?</h3>
        <CompositeInput
          variant="button"
          placeholder="Enter promo code..."
          buttonProps={{
            label: 'Apply',
            onClick: () => {}
          }}
        />
      </div>
    </div>
  )
}

// Contact Form
export const ContactForm: Story = {
  render: function ContactFormExample() {
    const [formData, setFormData] = useState({
      name: '',
      email: '',
      subject: ''
    })
    const [submitted, setSubmitted] = useState(false)

    const handleSubmit = (e: React.FormEvent) => {
      e.preventDefault()
      setSubmitted(true)
      setTimeout(() => {
        setSubmitted(false)
        setFormData({ name: '', email: '', subject: '' })
      }, 3000)
    }

    return (
      <form onSubmit={handleSubmit} className="w-96 space-y-4">
        <h3 className="text-base font-semibold">Contact Us</h3>

        <div>
          <label className="mb-1 block text-sm font-medium">Name</label>
          <CompositeInput
            variant="default"
            placeholder="Your name..."
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium">Email</label>
          <CompositeInput
            variant="email"
            type="email"
            placeholder="your@email.com"
            value={formData.email}
            onChange={(e) => setFormData({ ...formData, email: e.target.value })}
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium">Subject</label>
          <CompositeInput
            variant="button"
            placeholder="How can we help?"
            value={formData.subject}
            onChange={(e) => setFormData({ ...formData, subject: e.target.value })}
            buttonProps={{
              label: submitted ? '✓ Sent' : 'Send',
              onClick: (e) => handleSubmit(e as unknown as React.FormEvent)
            }}
          />
        </div>

        {submitted && <p className="text-sm text-green-600">Message sent successfully!</p>}
      </form>
    )
  }
}

// Accessibility
export const Accessibility: Story = {
  render: () => (
    <div className="w-96 space-y-6">
      <div>
        <h3 className="mb-4 text-base font-semibold">Keyboard Navigation</h3>
        <p className="mb-4 text-sm text-muted-foreground">
          Use Tab to navigate between inputs and buttons. Press Enter in the input to trigger the button action.
        </p>
        <div className="space-y-3">
          <CompositeInput
            variant="button"
            placeholder="First input..."
            buttonProps={{
              label: 'Action 1',
              onClick: () => {}
            }}
          />
          <CompositeInput
            variant="button"
            placeholder="Second input..."
            buttonProps={{
              label: 'Action 2',
              onClick: () => {}
            }}
          />
        </div>
      </div>

      <div>
        <h3 className="mb-4 text-base font-semibold">Password Accessibility</h3>
        <p className="mb-4 text-sm text-muted-foreground">
          The password toggle button has proper ARIA attributes for screen readers.
        </p>
        <CompositeInput variant="default" type="password" placeholder="Enter password..." />
      </div>
    </div>
  )
}

// All Size and Variant Combinations
export const AllCombinations: Story = {
  render: () => (
    <div className="flex flex-col gap-8">
      {/* Small Size */}
      <div className="w-[500px]">
        <h3 className="mb-4 text-base font-semibold">Small Size (sm)</h3>
        <div className="space-y-3">
          <CompositeInput variant="default" size="sm" placeholder="Default variant" />
          <CompositeInput variant="email" type="email" size="sm" placeholder="example.com" prefix="user@" />
          <CompositeInput
            variant="select"
            size="sm"
            placeholder="0.00"
            type="number"
            selectProps={{
              placeholder: 'USD',
              groups: [
                {
                  label: 'Currency',
                  items: [
                    { label: 'USD', value: 'usd' },
                    { label: 'EUR', value: 'eur' }
                  ]
                }
              ]
            }}
          />
          <CompositeInput
            variant="button"
            size="sm"
            placeholder="Button variant"
            buttonProps={{
              label: 'Go',
              onClick: () => {}
            }}
          />
          <CompositeInput variant="default" type="password" size="sm" placeholder="Password" />
        </div>
      </div>

      {/* Medium Size */}
      <div className="w-[500px]">
        <h3 className="mb-4 text-base font-semibold">Medium Size (md) - Default</h3>
        <div className="space-y-3">
          <CompositeInput variant="default" size="md" placeholder="Default variant" />
          <CompositeInput variant="email" type="email" size="md" placeholder="example.com" prefix="user@" />
          <CompositeInput
            variant="select"
            size="md"
            placeholder="0.00"
            type="number"
            selectProps={{
              placeholder: 'USD',
              groups: [
                {
                  label: 'Currency',
                  items: [
                    { label: 'USD', value: 'usd' },
                    { label: 'EUR', value: 'eur' }
                  ]
                }
              ]
            }}
          />
          <CompositeInput
            variant="button"
            size="md"
            placeholder="Button variant"
            buttonProps={{
              label: 'Submit',
              onClick: () => {}
            }}
          />
          <CompositeInput variant="default" type="password" size="md" placeholder="Password" />
        </div>
      </div>

      {/* Large Size */}
      <div className="w-[500px]">
        <h3 className="mb-4 text-base font-semibold">Large Size (lg)</h3>
        <div className="space-y-3">
          <CompositeInput variant="default" size="lg" placeholder="Default variant" />
          <CompositeInput variant="email" type="email" size="lg" placeholder="example.com" prefix="user@" />
          <CompositeInput
            variant="select"
            size="lg"
            placeholder="0.00"
            type="number"
            selectProps={{
              placeholder: 'USD',
              groups: [
                {
                  label: 'Currency',
                  items: [
                    { label: 'USD', value: 'usd' },
                    { label: 'EUR', value: 'eur' }
                  ]
                }
              ]
            }}
          />
          <CompositeInput
            variant="button"
            size="lg"
            placeholder="Button variant"
            buttonProps={{
              label: 'Send',
              onClick: () => {}
            }}
          />
          <CompositeInput variant="default" type="password" size="lg" placeholder="Password" />
        </div>
      </div>
    </div>
  )
}
