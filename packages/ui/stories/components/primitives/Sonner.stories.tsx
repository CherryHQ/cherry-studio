import { Button } from '@cherrystudio/ui'
import { toast, Toaster } from '@cherrystudio/ui'
import type { Meta, StoryObj } from '@storybook/react'
import { RefreshCwIcon } from 'lucide-react'

const meta: Meta<typeof Toaster> = {
  title: 'Components/Primitives/Sonner',
  component: Toaster,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'A custom toast notification component built on sonner. Features custom icons, action buttons, links, and support for info, success, warning, error, and loading states.'
      }
    }
  },
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <div className="flex min-h-[400px] w-full items-center justify-center">
        <Story />
        <Toaster />
      </div>
    )
  ]
}

export default meta
type Story = StoryObj<typeof meta>

// Basic Toast Types
export const Info: Story = {
  render: () => (
    <div className="flex flex-col gap-3">
      <Button
        onClick={() =>
          toast.info({
            title: 'Information',
            description: 'This is an informational message.'
          })
        }>
        Show Info Toast
      </Button>
    </div>
  )
}

export const Success: Story = {
  render: () => (
    <div className="flex flex-col gap-3">
      <Button
        onClick={() =>
          toast.success({
            title: 'Success!',
            description: 'Operation completed successfully.'
          })
        }>
        Show Success Toast
      </Button>
    </div>
  )
}

export const ErrorToast: Story = {
  render: () => (
    <div className="flex flex-col gap-3">
      <Button
        onClick={() =>
          toast.error({
            title: 'Error',
            description: 'Something went wrong. Please try again.'
          })
        }>
        Show Error Toast
      </Button>
    </div>
  )
}

export const Warning: Story = {
  render: () => (
    <div className="flex flex-col gap-3">
      <Button
        onClick={() =>
          toast.warning({
            title: 'Warning',
            description: 'Please be careful with this action.'
          })
        }>
        Show Warning Toast
      </Button>
    </div>
  )
}

export const Loading: Story = {
  render: () => {
    const mockPromise = new Promise((resolve) => {
      setTimeout(() => resolve('Data loaded'), 2000)
    })

    return (
      <div className="flex flex-col gap-3">
        <Button
          onClick={() =>
            toast.loading({
              title: 'Loading...',
              description: 'Please wait while we process your request.',
              promise: mockPromise
            })
          }>
          Show Loading Toast
        </Button>
      </div>
    )
  }
}

// All Toast Types Together
export const AllTypes: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      <Button onClick={() => toast.info({ title: 'Info Toast' })}>Info</Button>
      <Button onClick={() => toast.success({ title: 'Success Toast' })}>Success</Button>
      <Button onClick={() => toast.warning({ title: 'Warning Toast' })}>Warning</Button>
      <Button onClick={() => toast.error({ title: 'Error Toast' })}>Error</Button>
      <Button
        onClick={() =>
          toast.loading({
            title: 'Loading Toast',
            promise: new Promise((resolve) => setTimeout(resolve, 2000))
          })
        }>
        Loading
      </Button>
    </div>
  )
}

// With Description
export const WithDescription: Story = {
  render: () => (
    <div className="flex flex-col gap-3">
      <Button
        onClick={() =>
          toast.success({
            title: 'Event Created',
            description: 'Your event has been created successfully. You can now share it with others.'
          })
        }>
        Show Toast with Description
      </Button>
    </div>
  )
}

// With Colored Message
export const WithColoredMessage: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      <Button
        onClick={() =>
          toast.info({
            title: 'System Update',
            coloredMessage: 'New version available!',
            description: 'Click the button to update now.'
          })
        }>
        Info with Colored Message
      </Button>
      <Button
        onClick={() =>
          toast.warning({
            title: 'Disk Space Low',
            coloredMessage: '95% used',
            description: 'Please free up some space.'
          })
        }>
        Warning with Colored Message
      </Button>
    </div>
  )
}

// With Colored Background
export const WithColoredBackground: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      <Button
        onClick={() =>
          toast.info({
            title: 'Information',
            description: 'This toast has a colored background.',
            coloredBackground: true
          })
        }>
        Info Background
      </Button>
      <Button
        onClick={() =>
          toast.success({
            title: 'Success!',
            description: 'This toast has a colored background.',
            coloredBackground: true
          })
        }>
        Success Background
      </Button>
      <Button
        onClick={() =>
          toast.warning({
            title: 'Warning',
            description: 'This toast has a colored background.',
            coloredBackground: true
          })
        }>
        Warning Background
      </Button>
      <Button
        onClick={() =>
          toast.error({
            title: 'Error',
            description: 'This toast has a colored background.',
            coloredBackground: true
          })
        }>
        Error Background
      </Button>
    </div>
  )
}

// Colored Background with Actions
export const ColoredBackgroundWithActions: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      <Button
        onClick={() =>
          toast.success({
            title: 'File Uploaded',
            description: 'Your file has been uploaded successfully.',
            coloredBackground: true,
            button: {
              label: 'View',
              onClick: () => toast.info({ title: 'Opening file...' })
            }
          })
        }>
        Success with Button
      </Button>
      <Button
        onClick={() =>
          toast.warning({
            title: 'Action Required',
            description: 'Please review the changes.',
            coloredBackground: true,
            link: {
              label: 'Review',
              onClick: () => toast.info({ title: 'Opening review...' })
            }
          })
        }>
        Warning with Link
      </Button>
      <Button
        onClick={() =>
          toast.error({
            title: 'Update Failed',
            description: 'Failed to update the record.',
            coloredBackground: true,
            button: {
              icon: <RefreshCwIcon className="h-4 w-4" />,
              label: 'Retry',
              onClick: () => toast.info({ title: 'Retrying...' })
            },
            link: {
              label: 'Learn More',
              onClick: () => toast.info({ title: 'Opening help...' })
            }
          })
        }>
        Error with Button & Link
      </Button>
    </div>
  )
}

// With Action Button
export const WithActionButton: Story = {
  render: () => (
    <div className="flex flex-col gap-3">
      <Button
        onClick={() =>
          toast.success({
            title: 'Changes Saved',
            description: 'Your changes have been saved successfully.',
            button: {
              icon: <RefreshCwIcon className="h-4 w-4" />,
              label: 'Undo',
              onClick: () => toast.info({ title: 'Undoing changes...' })
            }
          })
        }>
        Show Toast with Action Button
      </Button>
    </div>
  )
}

// With Link
export const WithLink: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      <Button
        onClick={() =>
          toast.info({
            title: 'Update Available',
            description: 'A new version is ready to install.',
            link: {
              label: 'View Details',
              onClick: () => toast.info({ title: 'Opening details...' })
            }
          })
        }>
        Toast with Click Handler
      </Button>
      <Button
        onClick={() =>
          toast.success({
            title: 'Documentation Updated',
            description: 'Check out the new features.',
            link: {
              label: 'Read More',
              href: 'https://example.com',
              onClick: () => console.log('Link clicked')
            }
          })
        }>
        Toast with Link
      </Button>
    </div>
  )
}

// With Button and Link
export const WithButtonAndLink: Story = {
  render: () => (
    <div className="flex flex-col gap-3">
      <Button
        onClick={() =>
          toast.warning({
            title: 'Action Required',
            description: 'Please review the changes before proceeding.',
            button: {
              icon: <RefreshCwIcon className="h-4 w-4" />,
              label: 'Review',
              onClick: () => toast.info({ title: 'Opening review...' })
            },
            link: {
              label: 'Learn More',
              onClick: () => toast.info({ title: 'Opening documentation...' })
            }
          })
        }>
        Show Toast with Button and Link
      </Button>
    </div>
  )
}

// Dismissable Toast
export const DismissableToast: Story = {
  render: () => (
    <div className="flex flex-col gap-3">
      <Button
        onClick={() =>
          toast.info({
            title: 'Dismissable Toast',
            description: 'You can close this toast by clicking the X button.',
            dismissable: true,
            onDismiss: () => console.log('Toast dismissed')
          })
        }>
        Show Dismissable Toast
      </Button>
    </div>
  )
}

// Multiple Toasts
export const MultipleToasts: Story = {
  render: () => {
    const showMultiple = () => {
      toast.success({ title: 'First notification', description: 'This is the first message' })
      setTimeout(() => toast.info({ title: 'Second notification', description: 'This is the second message' }), 100)
      setTimeout(() => toast.warning({ title: 'Third notification', description: 'This is the third message' }), 200)
      setTimeout(() => toast.error({ title: 'Fourth notification', description: 'This is the fourth message' }), 300)
    }

    return (
      <div className="flex flex-col gap-3">
        <Button onClick={showMultiple}>Show Multiple Toasts</Button>
      </div>
    )
  }
}

// Promise Example
export const PromiseExample: Story = {
  render: () => {
    const handleAsyncOperation = () => {
      const promise = new Promise((resolve, reject) => {
        setTimeout(() => {
          Math.random() > 0.5 ? resolve({ name: 'John Doe' }) : reject(new Error('Failed to fetch data'))
        }, 2000)
      })

      toast.loading({
        title: 'Fetching data...',
        description: 'Please wait while we load your information.',
        promise
      })
    }

    return (
      <div className="flex flex-col gap-3">
        <Button onClick={handleAsyncOperation}>Show Promise Toast (Random Result)</Button>
      </div>
    )
  }
}

// Real World Examples
export const RealWorldExamples: Story = {
  render: () => {
    const handleFileSave = () => {
      const promise = new Promise((resolve) => setTimeout(resolve, 1500))
      toast.loading({
        title: 'Saving file...',
        promise
      })
      promise.then(() => {
        toast.success({
          title: 'File saved',
          description: 'Your file has been saved successfully.'
        })
      })
    }

    const handleFormSubmit = () => {
      toast.success({
        title: 'Form submitted',
        description: 'Your changes have been saved successfully.',
        button: {
          label: 'View',
          onClick: () => toast.info({ title: 'Opening form...' })
        }
      })
    }

    const handleDelete = () => {
      toast.error({
        title: 'Failed to delete',
        description: 'You do not have permission to delete this item.',
        button: {
          icon: <RefreshCwIcon className="h-4 w-4" />,
          label: 'Retry',
          onClick: () => toast.info({ title: 'Retrying...' })
        }
      })
    }

    const handleCopy = () => {
      navigator.clipboard.writeText('https://example.com')
      toast.success({
        title: 'Copied to clipboard',
        description: 'The link has been copied to your clipboard.'
      })
    }

    const handleUpdate = () => {
      toast.info({
        title: 'Update available',
        description: 'A new version of the application is ready to install.',
        button: {
          label: 'Update Now',
          onClick: () => toast.info({ title: 'Starting update...' })
        },
        link: {
          label: 'Release Notes',
          onClick: () => toast.info({ title: 'Opening release notes...' })
        }
      })
    }

    return (
      <div className="flex flex-col gap-4">
        <div>
          <h3 className="mb-3 text-sm font-semibold">File Operations</h3>
          <div className="flex gap-2">
            <Button onClick={handleFileSave}>Save File</Button>
            <Button variant="outline" onClick={handleCopy}>
              Copy Link
            </Button>
          </div>
        </div>

        <div>
          <h3 className="mb-3 text-sm font-semibold">Form Submissions</h3>
          <div className="flex gap-2">
            <Button onClick={handleFormSubmit}>Submit Form</Button>
          </div>
        </div>

        <div>
          <h3 className="mb-3 text-sm font-semibold">Error Handling</h3>
          <div className="flex gap-2">
            <Button variant="destructive" onClick={handleDelete}>
              Delete Item
            </Button>
          </div>
        </div>

        <div>
          <h3 className="mb-3 text-sm font-semibold">Updates & Notifications</h3>
          <div className="flex gap-2">
            <Button onClick={handleUpdate}>Show Update</Button>
          </div>
        </div>
      </div>
    )
  }
}
