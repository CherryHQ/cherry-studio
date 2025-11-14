import type { Meta, StoryObj } from '@storybook/react'
import {
  AtSign,
  Calendar,
  ChevronDown,
  Copy,
  DollarSign,
  Eye,
  EyeOff,
  Link,
  Lock,
  Mail,
  Percent,
  Search,
  Send,
  Settings,
  User,
  X
} from 'lucide-react'
import { useState } from 'react'

import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupText,
  InputGroupTextarea
} from '../../../src/components/primitives/input-group'

const meta: Meta<typeof InputGroup> = {
  title: 'Components/Primitives/InputGroup',
  component: InputGroup,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'A flexible input group component that allows you to add icons, buttons, and text addons to inputs. Supports inline and block alignment for various layout needs.'
      }
    }
  },
  tags: ['autodocs']
}

export default meta
type Story = StoryObj<typeof meta>

// Basic Examples
export const Default: Story = {
  render: () => (
    <div className="w-80">
      <InputGroup>
        <InputGroupInput placeholder="Enter text..." />
      </InputGroup>
    </div>
  )
}

export const WithIconStart: Story = {
  render: () => (
    <div className="w-80">
      <InputGroup>
        <InputGroupAddon align="inline-start">
          <InputGroupText>
            <User />
          </InputGroupText>
        </InputGroupAddon>
        <InputGroupInput placeholder="Username" />
      </InputGroup>
    </div>
  )
}

export const WithIconEnd: Story = {
  render: () => (
    <div className="w-80">
      <InputGroup>
        <InputGroupInput placeholder="Search..." />
        <InputGroupAddon align="inline-end">
          <InputGroupText>
            <Search />
          </InputGroupText>
        </InputGroupAddon>
      </InputGroup>
    </div>
  )
}

export const WithIconBoth: Story = {
  render: () => (
    <div className="w-80">
      <InputGroup>
        <InputGroupAddon align="inline-start">
          <InputGroupText>
            <Mail />
          </InputGroupText>
        </InputGroupAddon>
        <InputGroupInput type="email" placeholder="email@example.com" />
        <InputGroupAddon align="inline-end">
          <InputGroupText>
            <AtSign />
          </InputGroupText>
        </InputGroupAddon>
      </InputGroup>
    </div>
  )
}

// With Text Addons
export const WithTextStart: Story = {
  render: () => (
    <div className="w-80">
      <InputGroup>
        <InputGroupAddon align="inline-start">
          <InputGroupText>https://</InputGroupText>
        </InputGroupAddon>
        <InputGroupInput placeholder="example.com" />
      </InputGroup>
    </div>
  )
}

export const WithTextEnd: Story = {
  render: () => (
    <div className="w-80">
      <InputGroup>
        <InputGroupInput placeholder="username" />
        <InputGroupAddon align="inline-end">
          <InputGroupText>@example.com</InputGroupText>
        </InputGroupAddon>
      </InputGroup>
    </div>
  )
}

export const WithTextBoth: Story = {
  render: () => (
    <div className="w-80">
      <InputGroup>
        <InputGroupAddon align="inline-start">
          <InputGroupText>
            <DollarSign />
          </InputGroupText>
        </InputGroupAddon>
        <InputGroupInput type="number" placeholder="0.00" />
        <InputGroupAddon align="inline-end">
          <InputGroupText>USD</InputGroupText>
        </InputGroupAddon>
      </InputGroup>
    </div>
  )
}

// With Buttons
export const WithButtonEnd: Story = {
  render: () => (
    <div className="w-80">
      <InputGroup>
        <InputGroupInput placeholder="Enter email..." />
        <InputGroupAddon align="inline-end">
          <InputGroupButton>
            <Send />
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
    </div>
  )
}

export const WithButtonStart: Story = {
  render: () => (
    <div className="w-80">
      <InputGroup>
        <InputGroupAddon align="inline-start">
          <InputGroupButton>
            <Search />
          </InputGroupButton>
        </InputGroupAddon>
        <InputGroupInput placeholder="Search..." />
      </InputGroup>
    </div>
  )
}

export const WithMultipleButtons: Story = {
  render: () => (
    <div className="w-80">
      <InputGroup>
        <InputGroupInput placeholder="Enter text..." />
        <InputGroupAddon align="inline-end">
          <InputGroupButton size="icon-xs">
            <Copy />
          </InputGroupButton>
          <InputGroupButton size="icon-xs">
            <X />
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
    </div>
  )
}

// Block Alignment
export const BlockAlignmentStart: Story = {
  render: () => (
    <div className="w-80">
      <InputGroup>
        <InputGroupAddon align="block-start">
          <InputGroupText>Description</InputGroupText>
        </InputGroupAddon>
        <InputGroupInput placeholder="Enter description..." />
      </InputGroup>
    </div>
  )
}

export const BlockAlignmentEnd: Story = {
  render: () => (
    <div className="w-80">
      <InputGroup>
        <InputGroupInput placeholder="Enter message..." />
        <InputGroupAddon align="block-end">
          <InputGroupText>Character count: 0/500</InputGroupText>
        </InputGroupAddon>
      </InputGroup>
    </div>
  )
}

export const BlockAlignmentBoth: Story = {
  render: () => (
    <div className="w-80">
      <InputGroup>
        <InputGroupAddon align="block-start">
          <InputGroupText>Message</InputGroupText>
        </InputGroupAddon>
        <InputGroupInput placeholder="Type your message..." />
        <InputGroupAddon align="block-end">
          <InputGroupText>Max 200 characters</InputGroupText>
        </InputGroupAddon>
      </InputGroup>
    </div>
  )
}

// With Textarea
export const WithTextarea: Story = {
  render: () => (
    <div className="w-80">
      <InputGroup>
        <InputGroupTextarea placeholder="Enter your comment..." rows={4} />
        <InputGroupAddon align="block-end">
          <InputGroupText>0/500 characters</InputGroupText>
        </InputGroupAddon>
      </InputGroup>
    </div>
  )
}

export const TextareaWithButtons: Story = {
  render: () => (
    <div className="w-80">
      <InputGroup>
        <InputGroupAddon align="block-start">
          <InputGroupText>Comment</InputGroupText>
        </InputGroupAddon>
        <InputGroupTextarea placeholder="Write your comment..." rows={4} />
        <InputGroupAddon align="block-end">
          <InputGroupButton size="sm">Cancel</InputGroupButton>
          <InputGroupButton size="sm">Submit</InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
    </div>
  )
}

// Button Sizes
export const ButtonSizes: Story = {
  render: () => (
    <div className="flex w-96 flex-col gap-4">
      <div>
        <p className="mb-2 text-sm text-muted-foreground">Extra Small (xs)</p>
        <InputGroup>
          <InputGroupInput placeholder="Search..." />
          <InputGroupAddon align="inline-end">
            <InputGroupButton size="xs">Search</InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
      </div>

      <div>
        <p className="mb-2 text-sm text-muted-foreground">Small (sm)</p>
        <InputGroup>
          <InputGroupInput placeholder="Search..." />
          <InputGroupAddon align="inline-end">
            <InputGroupButton size="sm">Search</InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
      </div>

      <div>
        <p className="mb-2 text-sm text-muted-foreground">Icon Extra Small (icon-xs)</p>
        <InputGroup>
          <InputGroupInput placeholder="Search..." />
          <InputGroupAddon align="inline-end">
            <InputGroupButton size="icon-xs">
              <Search />
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
      </div>

      <div>
        <p className="mb-2 text-sm text-muted-foreground">Icon Small (icon-sm)</p>
        <InputGroup>
          <InputGroupInput placeholder="Search..." />
          <InputGroupAddon align="inline-end">
            <InputGroupButton size="icon-sm">
              <Search />
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
      </div>
    </div>
  )
}

// States
export const DisabledState: Story = {
  render: () => (
    <div className="w-80">
      <InputGroup data-disabled="true">
        <InputGroupAddon align="inline-start">
          <InputGroupText>
            <User />
          </InputGroupText>
        </InputGroupAddon>
        <InputGroupInput placeholder="Disabled input" disabled />
      </InputGroup>
    </div>
  )
}

export const ErrorState: Story = {
  render: () => (
    <div className="w-80">
      <InputGroup>
        <InputGroupAddon align="inline-start">
          <InputGroupText>
            <Mail />
          </InputGroupText>
        </InputGroupAddon>
        <InputGroupInput type="email" placeholder="email@example.com" aria-invalid />
      </InputGroup>
      <p className="mt-1 text-xs text-destructive">Please enter a valid email address.</p>
    </div>
  )
}

// Interactive Examples
export const PasswordToggle: Story = {
  render: function PasswordToggleExample() {
    const [showPassword, setShowPassword] = useState(false)

    return (
      <div className="w-80">
        <InputGroup>
          <InputGroupAddon align="inline-start">
            <InputGroupText>
              <Lock />
            </InputGroupText>
          </InputGroupAddon>
          <InputGroupInput type={showPassword ? 'text' : 'password'} placeholder="Enter password..." />
          <InputGroupAddon align="inline-end">
            <InputGroupButton size="icon-xs" onClick={() => setShowPassword(!showPassword)}>
              {showPassword ? <EyeOff /> : <Eye />}
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
      </div>
    )
  }
}

export const SearchWithClear: Story = {
  render: function SearchWithClearExample() {
    const [value, setValue] = useState('')

    return (
      <div className="w-80">
        <InputGroup>
          <InputGroupAddon align="inline-start">
            <InputGroupText>
              <Search />
            </InputGroupText>
          </InputGroupAddon>
          <InputGroupInput placeholder="Search..." value={value} onChange={(e) => setValue(e.target.value)} />
          {value && (
            <InputGroupAddon align="inline-end">
              <InputGroupButton size="icon-xs" onClick={() => setValue('')}>
                <X />
              </InputGroupButton>
            </InputGroupAddon>
          )}
        </InputGroup>
      </div>
    )
  }
}

export const CopyToClipboard: Story = {
  render: function CopyToClipboardExample() {
    const [copied, setCopied] = useState(false)
    const value = 'https://example.com/share/abc123'

    const handleCopy = () => {
      navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }

    return (
      <div className="w-96">
        <InputGroup>
          <InputGroupAddon align="inline-start">
            <InputGroupText>
              <Link />
            </InputGroupText>
          </InputGroupAddon>
          <InputGroupInput value={value} readOnly />
          <InputGroupAddon align="inline-end">
            <InputGroupButton size="xs" onClick={handleCopy}>
              {copied ? '✓ Copied' : <Copy />}
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
      </div>
    )
  }
}

export const CharacterCounter: Story = {
  render: function CharacterCounterExample() {
    const [value, setValue] = useState('')
    const maxLength = 100

    return (
      <div className="w-80">
        <InputGroup>
          <InputGroupInput
            placeholder="Enter message..."
            value={value}
            onChange={(e) => setValue(e.target.value)}
            maxLength={maxLength}
          />
          <InputGroupAddon align="inline-end">
            <InputGroupText>
              {value.length}/{maxLength}
            </InputGroupText>
          </InputGroupAddon>
        </InputGroup>
      </div>
    )
  }
}

// Real World Examples
export const LoginForm: Story = {
  render: () => (
    <div className="w-80 space-y-4">
      <h3 className="text-base font-semibold">Login</h3>

      <div>
        <label className="mb-1 block text-sm font-medium">Email</label>
        <InputGroup>
          <InputGroupAddon align="inline-start">
            <InputGroupText>
              <Mail />
            </InputGroupText>
          </InputGroupAddon>
          <InputGroupInput type="email" placeholder="email@example.com" />
        </InputGroup>
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium">Password</label>
        <InputGroup>
          <InputGroupAddon align="inline-start">
            <InputGroupText>
              <Lock />
            </InputGroupText>
          </InputGroupAddon>
          <InputGroupInput type="password" placeholder="Enter password..." />
        </InputGroup>
      </div>

      <button
        type="button"
        className="w-full rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90">
        Sign In
      </button>
    </div>
  )
}

export const PriceInput: Story = {
  render: () => (
    <div className="w-80 space-y-4">
      <div>
        <label className="mb-1 block text-sm font-medium">Amount (USD)</label>
        <InputGroup>
          <InputGroupAddon align="inline-start">
            <InputGroupText>
              <DollarSign />
            </InputGroupText>
          </InputGroupAddon>
          <InputGroupInput type="number" placeholder="0.00" step="0.01" />
          <InputGroupAddon align="inline-end">
            <InputGroupText>USD</InputGroupText>
          </InputGroupAddon>
        </InputGroup>
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium">Discount (%)</label>
        <InputGroup>
          <InputGroupInput type="number" placeholder="0" min="0" max="100" />
          <InputGroupAddon align="inline-end">
            <InputGroupText>
              <Percent />
            </InputGroupText>
          </InputGroupAddon>
        </InputGroup>
      </div>
    </div>
  )
}

export const UrlBuilder: Story = {
  render: function UrlBuilderExample() {
    const [protocol, setProtocol] = useState('https://')

    return (
      <div className="w-96 space-y-4">
        <div>
          <label className="mb-1 block text-sm font-medium">Website URL</label>
          <InputGroup>
            <InputGroupAddon align="inline-start">
              <InputGroupButton size="xs" onClick={() => setProtocol(protocol === 'https://' ? 'http://' : 'https://')}>
                {protocol}
                <ChevronDown />
              </InputGroupButton>
            </InputGroupAddon>
            <InputGroupInput placeholder="example.com" />
          </InputGroup>
        </div>
      </div>
    )
  }
}

export const SearchBar: Story = {
  render: function SearchBarExample() {
    const [query, setQuery] = useState('')
    const [loading, setLoading] = useState(false)

    const handleSearch = () => {
      setLoading(true)
      setTimeout(() => {
        setLoading(false)
      }, 1000)
    }

    return (
      <div className="w-96">
        <InputGroup>
          <InputGroupAddon align="inline-start">
            <InputGroupText>
              <Search />
            </InputGroupText>
          </InputGroupAddon>
          <InputGroupInput
            placeholder="Search..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          />
          {query && (
            <InputGroupAddon align="inline-end">
              <InputGroupButton size="icon-xs" onClick={() => setQuery('')}>
                <X />
              </InputGroupButton>
              <InputGroupButton size="sm" onClick={handleSearch} disabled={loading}>
                {loading ? 'Searching...' : 'Search'}
              </InputGroupButton>
            </InputGroupAddon>
          )}
        </InputGroup>
      </div>
    )
  }
}

export const DateTimeInput: Story = {
  render: () => (
    <div className="w-80 space-y-4">
      <div>
        <label className="mb-1 block text-sm font-medium">Event Date</label>
        <InputGroup>
          <InputGroupAddon align="inline-start">
            <InputGroupText>
              <Calendar />
            </InputGroupText>
          </InputGroupAddon>
          <InputGroupInput type="date" />
        </InputGroup>
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium">Event Time</label>
        <InputGroup>
          <InputGroupInput type="time" />
        </InputGroup>
      </div>
    </div>
  )
}

export const SettingsPanel: Story = {
  render: () => (
    <div className="w-96 space-y-4">
      <h3 className="text-base font-semibold">API Configuration</h3>

      <div>
        <label className="mb-1 block text-sm font-medium">API Key</label>
        <InputGroup>
          <InputGroupAddon align="inline-start">
            <InputGroupText>
              <Settings />
            </InputGroupText>
          </InputGroupAddon>
          <InputGroupInput type="password" placeholder="sk-..." />
          <InputGroupAddon align="inline-end">
            <InputGroupButton size="icon-xs">
              <Copy />
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
        <p className="mt-1 text-xs text-muted-foreground">Keep your API key secret and secure.</p>
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium">Base URL</label>
        <InputGroup>
          <InputGroupAddon align="inline-start">
            <InputGroupText>https://</InputGroupText>
          </InputGroupAddon>
          <InputGroupInput placeholder="api.example.com" />
        </InputGroup>
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium">Timeout (seconds)</label>
        <InputGroup>
          <InputGroupInput type="number" placeholder="30" min="1" />
          <InputGroupAddon align="inline-end">
            <InputGroupText>seconds</InputGroupText>
          </InputGroupAddon>
        </InputGroup>
      </div>
    </div>
  )
}

export const CommentBox: Story = {
  render: function CommentBoxExample() {
    const [comment, setComment] = useState('')
    const maxLength = 500

    return (
      <div className="w-96">
        <h3 className="mb-3 text-base font-semibold">Leave a Comment</h3>
        <InputGroup>
          <InputGroupTextarea
            placeholder="Write your comment..."
            rows={4}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            maxLength={maxLength}
          />
          <InputGroupAddon align="block-end">
            <InputGroupText>
              {comment.length}/{maxLength}
            </InputGroupText>
            <InputGroupButton size="sm" disabled={!comment.trim()}>
              Post Comment
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
      </div>
    )
  }
}
