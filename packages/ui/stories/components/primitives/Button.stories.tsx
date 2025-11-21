import { Button } from '@cherrystudio/ui'
import type { Meta, StoryObj } from '@storybook/react'
import { ChevronRight, Loader2, Mail } from 'lucide-react'

const meta: Meta<typeof Button> = {
  title: 'Components/Primitives/Button',
  component: Button,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: 'Displays a button or a component that looks like a button. Based on shadcn/ui.'
      }
    }
  },
  tags: ['autodocs'],
  argTypes: {
    variant: {
      control: { type: 'select' },
      options: ['default', 'destructive', 'outline', 'secondary', 'ghost', 'link'],
      description: 'The visual style variant of the button'
    },
    size: {
      control: { type: 'select' },
      options: ['default', 'sm', 'lg', 'icon', 'icon-sm', 'icon-lg'],
      description: 'The size of the button'
    },
    disabled: {
      control: { type: 'boolean' },
      description: 'Whether the button is disabled'
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
    children: 'Button'
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

export const Ghost: Story = {
  args: {
    variant: 'ghost',
    children: 'Ghost'
  }
}

export const Link: Story = {
  args: {
    variant: 'link',
    children: 'Link'
  }
}

// All Variants
export const AllVariants: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      <Button variant="default">Default</Button>
      <Button variant="secondary">Secondary</Button>
      <Button variant="destructive">Destructive</Button>
      <Button variant="outline">Outline</Button>
      <Button variant="ghost">Ghost</Button>
      <Button variant="link">Link</Button>
    </div>
  )
}

// Sizes
export const Small: Story = {
  args: {
    size: 'sm',
    children: 'Small'
  }
}

export const Large: Story = {
  args: {
    size: 'lg',
    children: 'Large'
  }
}

export const AllSizes: Story = {
  render: () => (
    <div className="flex items-center gap-2">
      <Button size="sm">Small</Button>
      <Button size="default">Default</Button>
      <Button size="lg">Large</Button>
    </div>
  )
}

// Icon Buttons
export const IconButton: Story = {
  render: () => (
    <Button variant="outline" size="icon" aria-label="Icon button">
      <ChevronRight className="h-4 w-4" />
    </Button>
  )
}

export const AllIconSizes: Story = {
  render: () => (
    <div className="flex items-center gap-2">
      <Button size="icon-sm" variant="outline" aria-label="Small icon button">
        <ChevronRight className="h-3 w-3" />
      </Button>
      <Button size="icon" variant="outline" aria-label="Default icon button">
        <ChevronRight className="h-4 w-4" />
      </Button>
      <Button size="icon-lg" variant="outline" aria-label="Large icon button">
        <ChevronRight className="h-5 w-5" />
      </Button>
    </div>
  )
}

// With Icon
export const WithIcon: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" size="sm">
        <Mail className="h-3 w-3" />
        Login with Email
      </Button>
      <Button variant="outline">
        <Mail className="h-4 w-4" />
        Login with Email
      </Button>
      <Button variant="outline" size="lg">
        <Mail className="h-5 w-5" />
        Login with Email
      </Button>
    </div>
  )
}

// Loading
export const Loading: Story = {
  render: () => (
    <div className="flex gap-2">
      <Button disabled>
        <Loader2 className="h-4 w-4 animate-spin" />
        Please wait
      </Button>
      <Button variant="outline" disabled>
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading...
      </Button>
    </div>
  )
}

// Rounded
export const Rounded: Story = {
  render: () => (
    <div className="flex gap-2">
      <Button className="rounded-full">Rounded</Button>
      <Button variant="outline" className="rounded-full">
        Rounded Outline
      </Button>
      <Button size="icon" variant="outline" className="rounded-full" aria-label="Rounded icon">
        <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  )
}

// States
export const Disabled: Story = {
  args: {
    disabled: true,
    children: 'Disabled'
  }
}

export const AllStates: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      <Button>Normal</Button>
      <Button disabled>Disabled</Button>
      <Button variant="outline">Normal Outline</Button>
      <Button variant="outline" disabled>
        Disabled Outline
      </Button>
    </div>
  )
}

// Full Width
export const FullWidth: Story = {
  render: () => (
    <div className="w-96">
      <Button className="w-full">Full Width Button</Button>
    </div>
  )
}

// As Child - Composition Pattern
// Note: asChild uses Radix UI's Slot component to merge Button's props
// with a single child element. The child must support prop spreading.
// Warning: asChild does NOT support loading prop (Slot requires single child)
export const AsChild: Story = {
  render: () => (
    <div className="flex flex-col gap-4">
      <div>
        <p className="mb-2 text-sm text-muted-foreground">Using asChild to render as an anchor tag:</p>
        <Button asChild variant="outline">
          <a href="https://github.com" target="_blank" rel="noopener noreferrer">
            Go to GitHub
          </a>
        </Button>
      </div>
      <div>
        <p className="mb-2 text-sm text-muted-foreground">Using asChild with link variant:</p>
        <Button variant="link" asChild>
          <a href="https://example.com" target="_blank" rel="noopener noreferrer">
            Example Link
          </a>
        </Button>
      </div>
      <div className="mt-4 rounded-md border border-yellow-200 bg-yellow-50 p-3 dark:border-yellow-900 dark:bg-yellow-950">
        <p className="text-sm text-yellow-800 dark:text-yellow-200">
          <strong>Note:</strong> The{' '}
          <code className="rounded bg-yellow-100 px-1 py-0.5 dark:bg-yellow-900">asChild</code> prop does not work with{' '}
          <code className="rounded bg-yellow-100 px-1 py-0.5 dark:bg-yellow-900">loading</code> because Radix Slot
          requires a single child element.
        </p>
      </div>
    </div>
  )
}

// Real World Examples
export const RealWorldExamples: Story = {
  render: () => (
    <div className="flex flex-col gap-6">
      {/* Action Buttons */}
      <div>
        <h3 className="mb-3 text-sm font-semibold">Action Buttons</h3>
        <div className="flex gap-2">
          <Button>Save Changes</Button>
          <Button variant="secondary">Cancel</Button>
          <Button variant="destructive">Delete</Button>
        </div>
      </div>

      {/* Icon Buttons */}
      <div>
        <h3 className="mb-3 text-sm font-semibold">Icon Buttons</h3>
        <div className="flex gap-2">
          <Button size="icon" variant="outline" aria-label="Next page">
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button size="icon" variant="ghost" aria-label="Send email">
            <Mail className="h-4 w-4" />
          </Button>
          <Button size="icon" variant="destructive" aria-label="Delete item">
            <span className="text-lg">×</span>
          </Button>
        </div>
      </div>

      {/* Loading States */}
      <div>
        <h3 className="mb-3 text-sm font-semibold">Loading States</h3>
        <div className="flex gap-2">
          <Button disabled>
            <Loader2 className="h-4 w-4 animate-spin" />
            Processing
          </Button>
          <Button variant="outline" disabled>
            <Loader2 className="h-4 w-4 animate-spin" />
            Uploading...
          </Button>
        </div>
      </div>

      {/* With Icons */}
      <div>
        <h3 className="mb-3 text-sm font-semibold">Buttons with Icons</h3>
        <div className="flex gap-2">
          <Button variant="outline">
            <Mail className="h-4 w-4" />
            Login with Email
          </Button>
          <Button>
            <ChevronRight className="h-4 w-4" />
            Continue
          </Button>
        </div>
      </div>

      {/* Rounded Variants */}
      <div>
        <h3 className="mb-3 text-sm font-semibold">Rounded Buttons</h3>
        <div className="flex gap-2">
          <Button className="rounded-full">Get Started</Button>
          <Button variant="outline" className="rounded-full">
            Learn More
          </Button>
          <Button size="icon" className="rounded-full" variant="outline" aria-label="Add item">
            +
          </Button>
        </div>
      </div>
    </div>
  )
}
