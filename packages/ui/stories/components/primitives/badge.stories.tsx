import { Badge } from '@cherrystudio/ui'
import type { Meta, StoryObj } from '@storybook/react'
import { Check, X } from 'lucide-react'

const meta: Meta<typeof Badge> = {
  title: 'Components/Primitives/Badge',
  component: Badge,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: 'Displays a badge or a component that looks like a badge. Based on shadcn/ui.'
      }
    }
  },
  tags: ['autodocs'],
  argTypes: {
    variant: {
      control: { type: 'select' },
      options: ['default', 'secondary', 'destructive', 'outline'],
      description: 'The visual style variant of the badge'
    },
    asChild: {
      control: { type: 'boolean' },
      description: 'Render as a child element'
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
    children: 'Badge'
  }
}

// Variants
export const Secondary: Story = {
  args: {
    variant: 'secondary',
    children: 'Secondary'
  }
}

export const Destructive: Story = {
  args: {
    variant: 'destructive',
    children: 'Destructive'
  }
}

export const Outline: Story = {
  args: {
    variant: 'outline',
    children: 'Outline'
  }
}

// All Variants
export const AllVariants: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      <Badge variant="default">Default</Badge>
      <Badge variant="secondary">Secondary</Badge>
      <Badge variant="destructive">Destructive</Badge>
      <Badge variant="outline">Outline</Badge>
    </div>
  )
}

// With Icons
export const WithIcon: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      <Badge>
        <Check />
        Success
      </Badge>
      <Badge variant="destructive">
        <X />
        Error
      </Badge>
      <Badge variant="secondary">
        <Check />
        Completed
      </Badge>
      <Badge variant="outline">
        <Check />
        Verified
      </Badge>
    </div>
  )
}

// As Link
export const AsLink: Story = {
  render: () => (
    <div className="flex flex-col gap-4">
      <div>
        <p className="mb-2 text-sm text-muted-foreground">Using asChild to render as an anchor tag:</p>
        <Badge asChild>
          <a href="https://github.com" target="_blank" rel="noopener noreferrer">
            GitHub
          </a>
        </Badge>
      </div>
      <div>
        <p className="mb-2 text-sm text-muted-foreground">All variants as links (hover to see effect):</p>
        <div className="flex gap-2">
          <Badge asChild variant="default">
            <a href="#">Default Link</a>
          </Badge>
          <Badge asChild variant="secondary">
            <a href="#">Secondary Link</a>
          </Badge>
          <Badge asChild variant="outline">
            <a href="#">Outline Link</a>
          </Badge>
        </div>
      </div>
    </div>
  )
}

// Status Badges
export const StatusBadges: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      <Badge variant="default">Active</Badge>
      <Badge variant="secondary">Pending</Badge>
      <Badge variant="destructive">Failed</Badge>
      <Badge variant="outline">Draft</Badge>
    </div>
  )
}

// Real World Examples
export const RealWorldExamples: Story = {
  render: () => (
    <div className="flex flex-col gap-6">
      {/* Status Indicators */}
      <div>
        <h3 className="mb-3 text-sm font-semibold">Status Indicators</h3>
        <div className="flex gap-2">
          <Badge>Online</Badge>
          <Badge variant="secondary">Away</Badge>
          <Badge variant="destructive">Offline</Badge>
          <Badge variant="outline">Unknown</Badge>
        </div>
      </div>

      {/* Labels */}
      <div>
        <h3 className="mb-3 text-sm font-semibold">Labels</h3>
        <div className="flex gap-2">
          <Badge variant="secondary">New</Badge>
          <Badge variant="secondary">Featured</Badge>
          <Badge variant="destructive">Hot</Badge>
          <Badge variant="outline">Beta</Badge>
        </div>
      </div>

      {/* Tags */}
      <div>
        <h3 className="mb-3 text-sm font-semibold">Tags</h3>
        <div className="flex gap-2">
          <Badge variant="outline">React</Badge>
          <Badge variant="outline">TypeScript</Badge>
          <Badge variant="outline">Tailwind</Badge>
          <Badge variant="outline">Shadcn</Badge>
        </div>
      </div>

      {/* Notification Counts */}
      <div>
        <h3 className="mb-3 text-sm font-semibold">Notification Counts</h3>
        <div className="flex gap-2">
          <Badge>3</Badge>
          <Badge variant="destructive">99+</Badge>
          <Badge variant="secondary">12</Badge>
        </div>
      </div>

      {/* With Icons */}
      <div>
        <h3 className="mb-3 text-sm font-semibold">With Icons</h3>
        <div className="flex gap-2">
          <Badge>
            <Check />
            Verified
          </Badge>
          <Badge variant="destructive">
            <X />
            Rejected
          </Badge>
        </div>
      </div>
    </div>
  )
}
