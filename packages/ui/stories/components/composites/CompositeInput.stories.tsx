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
      options: ['default', 'button', 'email'],
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
  args: {
    variant: 'email',
    type: 'email',
    placeholder: 'email@example.com'
  },
  render: (args) => (
    <div className="w-80">
      <CompositeInput {...args} />
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
      <p className="mt-2 text-xs text-muted-foreground">
        Password field with action button and visibility toggle
      </p>
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
        <CompositeInput variant="email" type="email" placeholder="email@example.com" />
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

// States
export const DisabledState: Story = {
  render: () => (
    <div className="flex w-96 flex-col gap-4">
      <div>
        <p className="mb-2 text-sm text-muted-foreground">Disabled - Default Variant</p>
        <CompositeInput variant="default" placeholder="Disabled input" disabled defaultValue="Cannot edit" />
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

      <div>
        <p className="mb-2 text-sm text-muted-foreground">Disabled - Email Variant</p>
        <CompositeInput variant="email" type="email" placeholder="email@example.com" disabled />
      </div>
    </div>
  )
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
          <CompositeInput variant="email" type="email" size="sm" placeholder="email@example.com" />
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
          <CompositeInput variant="email" type="email" size="md" placeholder="email@example.com" />
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
          <CompositeInput variant="email" type="email" size="lg" placeholder="email@example.com" />
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
