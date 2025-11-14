import type { Meta, StoryObj } from '@storybook/react'
import { Mail, Search, User } from 'lucide-react'
import { useState } from 'react'

import { Input } from '../../../src/components/primitives/input'

const meta: Meta<typeof Input> = {
  title: 'Components/Primitives/Input',
  component: Input,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'A basic text input component with focus states, error handling, and file upload support. Built with accessibility in mind and styled with Tailwind CSS.'
      }
    }
  },
  tags: ['autodocs'],
  argTypes: {
    type: {
      control: { type: 'select' },
      options: ['text', 'email', 'password', 'number', 'search', 'tel', 'url', 'date', 'time', 'file'],
      description: 'The type of the input'
    },
    placeholder: {
      control: { type: 'text' },
      description: 'Placeholder text'
    },
    disabled: {
      control: { type: 'boolean' },
      description: 'Whether the input is disabled'
    },
    className: {
      control: { type: 'text' },
      description: 'Additional CSS classes'
    }
  }
}

export default meta
type Story = StoryObj<typeof meta>

// Default
export const Default: Story = {
  args: {
    placeholder: 'Enter text...'
  }
}

// With Value
export const WithValue: Story = {
  args: {
    defaultValue: 'Hello World',
    placeholder: 'Enter text...'
  }
}

// Types
export const TextType: Story = {
  args: {
    type: 'text',
    placeholder: 'Enter text...'
  }
}

export const EmailType: Story = {
  args: {
    type: 'email',
    placeholder: 'Enter email...'
  }
}

export const PasswordType: Story = {
  args: {
    type: 'password',
    placeholder: 'Enter password...'
  }
}

export const NumberType: Story = {
  args: {
    type: 'number',
    placeholder: 'Enter number...'
  }
}

export const SearchType: Story = {
  args: {
    type: 'search',
    placeholder: 'Search...'
  }
}

// All Input Types
export const AllInputTypes: Story = {
  render: () => (
    <div className="flex w-80 flex-col gap-4">
      <div>
        <label className="mb-1 block text-sm font-medium">Text</label>
        <Input type="text" placeholder="Enter text..." />
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium">Email</label>
        <Input type="email" placeholder="email@example.com" />
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium">Password</label>
        <Input type="password" placeholder="Enter password..." />
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium">Number</label>
        <Input type="number" placeholder="0" />
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium">Search</label>
        <Input type="search" placeholder="Search..." />
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium">URL</label>
        <Input type="url" placeholder="https://example.com" />
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium">Tel</label>
        <Input type="tel" placeholder="+1 (555) 000-0000" />
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium">Date</label>
        <Input type="date" />
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium">Time</label>
        <Input type="time" />
      </div>
    </div>
  )
}

// States
export const Disabled: Story = {
  args: {
    disabled: true,
    placeholder: 'Disabled input',
    defaultValue: 'Cannot edit this'
  }
}

export const ReadOnly: Story = {
  args: {
    readOnly: true,
    defaultValue: 'Read-only value'
  }
}

export const ErrorState: Story = {
  render: () => (
    <div className="w-80">
      <Input placeholder="Invalid input..." aria-invalid />
    </div>
  )
}

// All States
export const AllStates: Story = {
  render: () => (
    <div className="flex w-80 flex-col gap-4">
      <div>
        <p className="mb-2 text-sm text-muted-foreground">Normal</p>
        <Input placeholder="Normal input" />
      </div>
      <div>
        <p className="mb-2 text-sm text-muted-foreground">With Value</p>
        <Input defaultValue="Input with value" />
      </div>
      <div>
        <p className="mb-2 text-sm text-muted-foreground">Disabled</p>
        <Input disabled placeholder="Disabled input" />
      </div>
      <div>
        <p className="mb-2 text-sm text-muted-foreground">Read-only</p>
        <Input readOnly defaultValue="Read-only value" />
      </div>
      <div>
        <p className="mb-2 text-sm text-muted-foreground">Error State</p>
        <Input placeholder="Invalid input" aria-invalid />
      </div>
    </div>
  )
}

// Controlled
export const Controlled: Story = {
  render: function ControlledExample() {
    const [value, setValue] = useState('')

    return (
      <div className="flex w-80 flex-col gap-4">
        <Input placeholder="Type something..." value={value} onChange={(e) => setValue(e.target.value)} />
        <div className="text-sm text-muted-foreground">
          Current value: <span className="font-mono">{value || '(empty)'}</span>
        </div>
        <div className="text-sm text-muted-foreground">Length: {value.length}</div>
      </div>
    )
  }
}

// With Labels
export const WithLabels: Story = {
  render: () => (
    <div className="flex w-80 flex-col gap-4">
      <div>
        <label htmlFor="username" className="mb-1 block text-sm font-medium">
          Username
        </label>
        <Input id="username" placeholder="Enter username..." />
      </div>
      <div>
        <label htmlFor="email" className="mb-1 block text-sm font-medium">
          Email
        </label>
        <Input id="email" type="email" placeholder="email@example.com" />
      </div>
      <div>
        <label htmlFor="password" className="mb-1 block text-sm font-medium">
          Password
        </label>
        <Input id="password" type="password" placeholder="Enter password..." />
      </div>
    </div>
  )
}

// With Helper Text
export const WithHelperText: Story = {
  render: () => (
    <div className="flex w-80 flex-col gap-4">
      <div>
        <label htmlFor="email-helper" className="mb-1 block text-sm font-medium">
          Email
        </label>
        <Input id="email-helper" type="email" placeholder="email@example.com" />
        <p className="mt-1 text-xs text-muted-foreground">We'll never share your email with anyone else.</p>
      </div>
      <div>
        <label htmlFor="password-helper" className="mb-1 block text-sm font-medium">
          Password
        </label>
        <Input id="password-helper" type="password" placeholder="Enter password..." />
        <p className="mt-1 text-xs text-muted-foreground">Must be at least 8 characters long.</p>
      </div>
    </div>
  )
}

// With Error Message
export const WithErrorMessage: Story = {
  render: () => (
    <div className="flex w-80 flex-col gap-4">
      <div>
        <label htmlFor="email-error" className="mb-1 block text-sm font-medium">
          Email
        </label>
        <Input id="email-error" type="email" placeholder="email@example.com" aria-invalid />
        <p className="mt-1 text-xs text-destructive">Please enter a valid email address.</p>
      </div>
      <div>
        <label htmlFor="password-error" className="mb-1 block text-sm font-medium">
          Password
        </label>
        <Input id="password-error" type="password" placeholder="Enter password..." aria-invalid />
        <p className="mt-1 text-xs text-destructive">Password must be at least 8 characters.</p>
      </div>
    </div>
  )
}

// File Input
export const FileInput: Story = {
  render: () => (
    <div className="w-80">
      <label htmlFor="file" className="mb-1 block text-sm font-medium">
        Upload File
      </label>
      <Input id="file" type="file" />
    </div>
  )
}

// Multiple Files
export const MultipleFiles: Story = {
  render: () => (
    <div className="w-80">
      <label htmlFor="files" className="mb-1 block text-sm font-medium">
        Upload Multiple Files
      </label>
      <Input id="files" type="file" multiple />
    </div>
  )
}

// Form Example
export const FormExample: Story = {
  render: function FormExample() {
    const [formData, setFormData] = useState({
      username: '',
      email: '',
      password: '',
      confirmPassword: ''
    })
    const [errors, setErrors] = useState<Record<string, string>>({})
    const [submitted, setSubmitted] = useState(false)

    const handleSubmit = (e: React.FormEvent) => {
      e.preventDefault()
      const newErrors: Record<string, string> = {}

      if (!formData.username) newErrors.username = 'Username is required'
      if (!formData.email) newErrors.email = 'Email is required'
      if (!formData.password) newErrors.password = 'Password is required'
      if (formData.password !== formData.confirmPassword) newErrors.confirmPassword = 'Passwords do not match'

      setErrors(newErrors)

      if (Object.keys(newErrors).length === 0) {
        setSubmitted(true)
        setTimeout(() => setSubmitted(false), 3000)
      }
    }

    return (
      <form onSubmit={handleSubmit} className="w-80 space-y-4">
        <h3 className="text-base font-semibold">Sign Up Form</h3>

        <div>
          <label htmlFor="form-username" className="mb-1 block text-sm font-medium">
            Username
          </label>
          <Input
            id="form-username"
            placeholder="Enter username..."
            value={formData.username}
            onChange={(e) => setFormData({ ...formData, username: e.target.value })}
            aria-invalid={!!errors.username}
          />
          {errors.username && <p className="mt-1 text-xs text-destructive">{errors.username}</p>}
        </div>

        <div>
          <label htmlFor="form-email" className="mb-1 block text-sm font-medium">
            Email
          </label>
          <Input
            id="form-email"
            type="email"
            placeholder="email@example.com"
            value={formData.email}
            onChange={(e) => setFormData({ ...formData, email: e.target.value })}
            aria-invalid={!!errors.email}
          />
          {errors.email && <p className="mt-1 text-xs text-destructive">{errors.email}</p>}
        </div>

        <div>
          <label htmlFor="form-password" className="mb-1 block text-sm font-medium">
            Password
          </label>
          <Input
            id="form-password"
            type="password"
            placeholder="Enter password..."
            value={formData.password}
            onChange={(e) => setFormData({ ...formData, password: e.target.value })}
            aria-invalid={!!errors.password}
          />
          {errors.password && <p className="mt-1 text-xs text-destructive">{errors.password}</p>}
        </div>

        <div>
          <label htmlFor="form-confirm" className="mb-1 block text-sm font-medium">
            Confirm Password
          </label>
          <Input
            id="form-confirm"
            type="password"
            placeholder="Confirm password..."
            value={formData.confirmPassword}
            onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
            aria-invalid={!!errors.confirmPassword}
          />
          {errors.confirmPassword && <p className="mt-1 text-xs text-destructive">{errors.confirmPassword}</p>}
        </div>

        <button
          type="submit"
          className="w-full rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90">
          Sign Up
        </button>

        {submitted && <p className="text-center text-sm text-green-600">Form submitted successfully!</p>}
      </form>
    )
  }
}

// Search Example
export const SearchExample: Story = {
  render: function SearchExample() {
    const [query, setQuery] = useState('')
    const items = ['Apple', 'Banana', 'Cherry', 'Date', 'Elderberry', 'Fig', 'Grape']
    const filtered = items.filter((item) => item.toLowerCase().includes(query.toLowerCase()))

    return (
      <div className="w-80 space-y-4">
        <div>
          <label htmlFor="search" className="mb-1 flex items-center gap-2 text-sm font-medium">
            <Search className="size-4" />
            Search Fruits
          </label>
          <Input
            id="search"
            type="search"
            placeholder="Type to search..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        <div className="rounded-md border p-3">
          <p className="mb-2 text-sm font-medium">Results ({filtered.length})</p>
          {filtered.length > 0 ? (
            <ul className="space-y-1">
              {filtered.map((item) => (
                <li key={item} className="text-sm text-muted-foreground">
                  {item}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No results found</p>
          )}
        </div>
      </div>
    )
  }
}

// Real World Examples
export const RealWorldExamples: Story = {
  render: () => (
    <div className="flex flex-col gap-8">
      {/* Login Form */}
      <div className="w-80">
        <h3 className="mb-4 text-base font-semibold">Login Form</h3>
        <div className="space-y-3">
          <div>
            <label htmlFor="login-email" className="mb-1 flex items-center gap-2 text-sm font-medium">
              <Mail className="size-4" />
              Email
            </label>
            <Input id="login-email" type="email" placeholder="email@example.com" />
          </div>
          <div>
            <label htmlFor="login-password" className="mb-1 block text-sm font-medium">
              Password
            </label>
            <Input id="login-password" type="password" placeholder="Enter password..." />
          </div>
          <button
            type="button"
            className="w-full rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90">
            Sign In
          </button>
        </div>
      </div>

      {/* Profile Form */}
      <div className="w-80">
        <h3 className="mb-4 text-base font-semibold">Profile Information</h3>
        <div className="space-y-3">
          <div>
            <label htmlFor="profile-name" className="mb-1 flex items-center gap-2 text-sm font-medium">
              <User className="size-4" />
              Full Name
            </label>
            <Input id="profile-name" placeholder="John Doe" />
          </div>
          <div>
            <label htmlFor="profile-email" className="mb-1 flex items-center gap-2 text-sm font-medium">
              <Mail className="size-4" />
              Email
            </label>
            <Input id="profile-email" type="email" placeholder="john@example.com" />
          </div>
          <div>
            <label htmlFor="profile-phone" className="mb-1 block text-sm font-medium">
              Phone
            </label>
            <Input id="profile-phone" type="tel" placeholder="+1 (555) 000-0000" />
          </div>
          <button
            type="button"
            className="w-full rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90">
            Save Changes
          </button>
        </div>
      </div>
    </div>
  )
}

// Accessibility
export const Accessibility: Story = {
  render: () => (
    <div className="w-80 space-y-6">
      <div>
        <h3 className="mb-4 text-base font-semibold">Keyboard Navigation</h3>
        <p className="mb-4 text-sm text-muted-foreground">Use Tab to navigate between inputs.</p>
        <div className="space-y-3">
          <Input placeholder="First input" />
          <Input placeholder="Second input" />
          <Input placeholder="Third input" />
        </div>
      </div>

      <div>
        <h3 className="mb-4 text-base font-semibold">ARIA Labels</h3>
        <p className="mb-4 text-sm text-muted-foreground">
          Inputs include proper ARIA attributes for screen reader support.
        </p>
        <div className="space-y-3">
          <Input placeholder="Input with aria-label" aria-label="Username input" />
          <Input placeholder="Invalid input" aria-invalid aria-describedby="error-message" />
          <p id="error-message" className="text-xs text-destructive">
            This input has an error
          </p>
        </div>
      </div>
    </div>
  )
}
