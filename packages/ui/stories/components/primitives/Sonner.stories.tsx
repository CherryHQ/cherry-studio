import { Button } from '@cherrystudio/ui'
import { toast, Toaster } from '@cherrystudio/ui'
import type { Meta, StoryObj } from '@storybook/react'
import { CheckIcon } from 'lucide-react'

interface PlaygroundArgs {
  type: 'info' | 'success' | 'warning' | 'error' | 'loading'
  title: string
  description: string
  colored: boolean
  duration: number
  dismissable: boolean
  closeButton: boolean
  withButton: boolean
  buttonLabel: string
}

const meta: Meta<typeof Toaster> = {
  title: 'Components/Primitives/Sonner',
  component: Toaster,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'A toast notification component built on Sonner with custom icons and styling. Supports info, success, warning, error, loading, and custom toast types with discriminated union types for type-safe APIs.'
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

// Playground
export const Playground: StoryObj<PlaygroundArgs> = {
  args: {
    type: 'info',
    title: 'Notification Title',
    description: 'This is a description that provides more details about the notification.',
    colored: false,
    duration: 4000,
    dismissable: true,
    closeButton: false,
    withButton: false,
    buttonLabel: 'Action'
  },
  argTypes: {
    type: {
      control: 'select',
      options: ['info', 'success', 'warning', 'error', 'loading'],
      description: 'Type of toast notification'
    },
    title: {
      control: 'text',
      description: 'Main message of the toast'
    },
    description: {
      control: 'text',
      description: 'Optional detailed description'
    },
    colored: {
      control: 'boolean',
      description: 'Enable colored background with backdrop blur'
    },
    duration: {
      control: { type: 'number', min: 1000, max: 10000, step: 1000 },
      description: 'Duration in milliseconds (use Infinity for persistent)'
    },
    dismissable: {
      control: 'boolean',
      description: 'Whether the toast can be dismissed by user interaction (click, swipe)'
    },
    closeButton: {
      control: 'boolean',
      description: 'Whether to show a close button'
    },
    withButton: {
      control: 'boolean',
      description: 'Show action button'
    },
    buttonLabel: {
      control: 'text',
      description: 'Label for the action button',
      if: { arg: 'withButton', truthy: true }
    }
  },
  render: (args: PlaygroundArgs) => {
    const handleToast = () => {
      const toastOptions = {
        description: args.description || undefined,
        colored: args.colored,
        duration: args.duration,
        dismissable: args.dismissable,
        closeButton: args.closeButton,
        ...(args.withButton && {
          button: {
            label: args.buttonLabel || 'Action',
            onClick: () => toast.info('Button clicked!')
          }
        })
      }

      switch (args.type) {
        case 'info':
          toast.info(args.title, toastOptions)
          break
        case 'success':
          toast.success(args.title, toastOptions)
          break
        case 'warning':
          toast.warning(args.title, toastOptions)
          break
        case 'error':
          toast.error(args.title, toastOptions)
          break
        case 'loading':
          toast.loading(args.title, {
            ...toastOptions,
            promise: new Promise<void>((resolve) => setTimeout(resolve, 2000))
          })
          break
      }
    }

    return (
      <div className="flex flex-col gap-3">
        <Button onClick={handleToast}>Show Toast</Button>
        <div className="text-sm text-muted-foreground max-w-md">
          Use the controls panel below to customize the toast properties and click the button to preview.
        </div>
      </div>
    )
  }
}

// Basic Toast Types
export const Info: Story = {
  render: () => (
    <div className="flex flex-col gap-3">
      <Button
        onClick={() =>
          toast.info('Information', {
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
          toast.success('Success!', {
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
          toast.error('Error', {
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
          toast.warning('Warning', {
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
    return (
      <div className="flex flex-col gap-3">
        <Button
          onClick={() =>
            toast.loading('Loading...', {
              description: 'Please wait while we process your request.',
              promise: new Promise((resolve) => {
                setTimeout(() => resolve('Data loaded'), 2000)
              })
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
      <Button onClick={() => toast.info('Info Toast')}>Info</Button>
      <Button onClick={() => toast.success('Success Toast')}>Success</Button>
      <Button onClick={() => toast.warning('Warning Toast')}>Warning</Button>
      <Button onClick={() => toast.error('Error Toast')}>Error</Button>
      <Button
        onClick={() =>
          toast.loading('Loading Toast', {
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
          toast.success('Event Created', {
            description: 'Your event has been created successfully. You can now share it with others.'
          })
        }>
        Show Toast with Description
      </Button>
    </div>
  )
}

// With Custom Duration
export const WithCustomDuration: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      <Button
        onClick={() =>
          toast.info('Quick message', {
            description: 'This will disappear in 1 second',
            duration: 1000
          })
        }>
        1 Second
      </Button>
      <Button
        onClick={() =>
          toast.success('Normal duration', {
            description: 'This uses default duration (4 seconds)'
          })
        }>
        Default (4s)
      </Button>
      <Button
        onClick={() =>
          toast.warning('Important message', {
            description: 'This will stay for 10 seconds',
            duration: 10000
          })
        }>
        10 Seconds
      </Button>
      <Button
        onClick={() =>
          toast.info('Persistent message', {
            description: 'This will stay until manually dismissed',
            duration: Number.POSITIVE_INFINITY
          })
        }>
        Infinite
      </Button>
    </div>
  )
}

// With Action Button
export const WithActionButton: Story = {
  render: () => (
    <div className="flex flex-col gap-2">
      <Button
        onClick={() =>
          toast.success('Changes Saved', {
            description: 'Your changes have been saved successfully.',
            button: {
              label: 'Undo',
              onClick: () => toast.info('Undoing changes...')
            }
          })
        }>
        Success with Action
      </Button>
      <Button
        onClick={() =>
          toast.error('Update Failed', {
            description: 'Failed to update the record.',
            button: {
              label: 'Retry',
              onClick: () => toast.info('Retrying...')
            }
          })
        }>
        Error with Action
      </Button>
      <Button
        onClick={() =>
          toast.info('Update Available', {
            description: 'A new version is ready to install.',
            button: {
              label: 'Update',
              onClick: () => toast.info('Starting update...')
            }
          })
        }>
        Info with Action
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
          toast.info('Information', {
            description: 'This toast has a colored background.',
            colored: true
          })
        }>
        Info Background
      </Button>
      <Button
        onClick={() =>
          toast.success('Success!', {
            description: 'This toast has a colored background.',
            colored: true
          })
        }>
        Success Background
      </Button>
      <Button
        onClick={() =>
          toast.warning('Warning', {
            description: 'This toast has a colored background.',
            colored: true
          })
        }>
        Warning Background
      </Button>
      <Button
        onClick={() =>
          toast.error('Error', {
            description: 'This toast has a colored background.',
            colored: true
          })
        }>
        Error Background
      </Button>
    </div>
  )
}

// Colored Background with Action
export const ColoredBackgroundWithAction: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      <Button
        onClick={() =>
          toast.success('File Uploaded', {
            description: 'Your file has been uploaded successfully.',
            colored: true,
            button: {
              label: 'View',
              onClick: () => toast.info('Opening file...')
            }
          })
        }>
        Success with Button
      </Button>
      <Button
        onClick={() =>
          toast.warning('Action Required', {
            description: 'Please review the changes.',
            colored: true,
            button: {
              label: 'Review',
              onClick: () => toast.info('Opening review...')
            }
          })
        }>
        Warning with Button
      </Button>
      <Button
        onClick={() =>
          toast.error('Update Failed', {
            description: 'Failed to update the record.',
            colored: true,
            button: {
              label: 'Retry',
              onClick: () => toast.info('Retrying...')
            }
          })
        }>
        Error with Button
      </Button>
    </div>
  )
}

// Multiple Toasts
export const MultipleToasts: Story = {
  render: () => {
    const showMultiple = () => {
      toast.success('First notification', { description: 'This is the first message' })
      setTimeout(() => toast.info('Second notification', { description: 'This is the second message' }), 100)
      setTimeout(() => toast.warning('Third notification', { description: 'This is the third message' }), 200)
      setTimeout(() => toast.error('Fourth notification', { description: 'This is the fourth message' }), 300)
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

      toast.loading('Fetching data...', {
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

// Promise with Success/Error Callbacks
export const PromiseWithCallbacks: Story = {
  render: () => {
    const handleSuccessCase = () => {
      const promise = new Promise<{ name: string }>((resolve) => {
        setTimeout(() => resolve({ name: 'John Doe' }), 2000)
      })

      toast.loading('Loading user data...', {
        description: 'Please wait...',
        promise
      })

      promise.then((data) => {
        toast.success('Data loaded successfully', {
          description: `Welcome back, ${data.name}!`
        })
      })
    }

    const handleErrorCase = () => {
      const promise = new Promise<void>((_, reject) => {
        setTimeout(() => reject(new Error('Network error')), 2000)
      })

      toast.loading('Connecting to server...', {
        description: 'Please wait...',
        promise
      })

      promise.catch((error: Error) => {
        toast.error('Connection failed', {
          description: error.message,
          button: {
            label: 'Retry',
            onClick: () => handleErrorCase()
          }
        })
      })
    }

    const handleRandomCase = () => {
      const promise = new Promise<{ message: string }>((resolve, reject) => {
        setTimeout(() => {
          Math.random() > 0.5 ? resolve({ message: 'Operation completed' }) : reject(new Error('Something went wrong'))
        }, 2000)
      })

      toast.loading('Processing...', {
        description: 'This may take a moment.',
        promise
      })

      promise
        .then((data) => {
          toast.success('Success!', {
            description: data.message,
            colored: true
          })
        })
        .catch((error: Error) => {
          toast.error('Failed!', {
            description: error.message,
            colored: true,
            button: {
              label: 'Try Again',
              onClick: () => handleRandomCase()
            }
          })
        })
    }

    return (
      <div className="flex flex-col gap-4">
        <div className="text-sm text-muted-foreground max-w-md">
          Demonstrates how to show success or error toasts after a promise resolves or rejects.
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={handleSuccessCase}>Always Success</Button>
          <Button onClick={handleErrorCase}>Always Error</Button>
          <Button onClick={handleRandomCase}>Random Result</Button>
        </div>
      </div>
    )
  }
}

// Real World Examples
export const RealWorldExamples: Story = {
  render: () => {
    const handleFileSave = () => {
      const promise = new Promise((resolve) => setTimeout(resolve, 1500))
      toast.loading('Saving file...', {
        promise
      })
      promise.then(() => {
        toast.success('File saved', {
          description: 'Your file has been saved successfully.',
          button: {
            label: 'View',
            onClick: () => toast.info('Opening file...')
          }
        })
      })
    }

    const handleFormSubmit = () => {
      toast.success('Form submitted', {
        description: 'Your changes have been saved successfully.',
        button: {
          label: 'Undo',
          onClick: () => toast.info('Undoing changes...')
        }
      })
    }

    const handleDelete = () => {
      toast.error('Failed to delete', {
        description: 'You do not have permission to delete this item.',
        button: {
          label: 'Retry',
          onClick: () => toast.info('Retrying...')
        }
      })
    }

    const handleCopy = () => {
      navigator.clipboard.writeText('https://example.com')
      toast.success('Copied to clipboard', {
        description: 'The link has been copied to your clipboard.'
      })
    }

    const handleUpdate = () => {
      toast.info('Update available', {
        description: 'A new version of the application is ready to install.',
        colored: true,
        button: {
          label: 'Update Now',
          onClick: () => toast.info('Starting update...')
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

// Custom Toast with JSX
export const CustomToast: Story = {
  render: () => {
    const showCustomToast = () => {
      toast.custom({
        jsx: (id) => (
          <div className="flex items-center gap-4 rounded-xs bg-gradient-to-r from-purple-500 to-pink-500 p-4 text-white shadow-lg">
            <CheckIcon className="size-6" />
            <div className="flex flex-col gap-1">
              <div className="text-md font-medium leading-4.5">Custom Design</div>
              <div className="text-xs leading-3.5">This is a fully customized toast with JSX</div>
            </div>
            <button
              type="button"
              onClick={() => toast.dismiss(id)}
              className="ml-auto rounded-3xs bg-white/20 px-2 py-1 text-xs hover:bg-white/30">
              Dismiss
            </button>
          </div>
        ),
        data: {
          duration: 5000
        }
      })
    }

    return (
      <div className="flex flex-col gap-3">
        <Button onClick={showCustomToast}>Show Custom Toast</Button>
        <div className="text-sm text-muted-foreground max-w-md">
          Custom toasts allow you to render any JSX content with full styling control.
        </div>
      </div>
    )
  }
}

// Close Button Control
export const CloseButtonControl: Story = {
  render: () => {
    return (
      <div className="flex flex-wrap gap-2">
        <Button
          onClick={() =>
            toast.info('With close button', {
              description: 'Click the X to close this toast',
              closeButton: true,
              duration: Number.POSITIVE_INFINITY
            })
          }>
          With Close Button
        </Button>
        <Button
          onClick={() =>
            toast.warning('Without close button', {
              description: 'This will auto-close after 3 seconds',
              closeButton: false,
              duration: 3000
            })
          }>
          Without Close Button (Default)
        </Button>
      </div>
    )
  }
}

// With Custom Class Names
export const WithCustomClassNames: Story = {
  render: () => {
    return (
      <div className="flex flex-col gap-3">
        <Button
          onClick={() =>
            toast.success('Custom Styled Toast', {
              description: 'This toast has custom class names applied',
              classNames: {
                toast: 'border-2 border-green-500',
                title: 'text-lg font-bold',
                description: 'text-green-700 italic'
              }
            })
          }>
          Custom Class Names
        </Button>
        <div className="text-sm text-muted-foreground max-w-md">
          You can customize specific parts of the toast using the classNames prop.
        </div>
      </div>
    )
  }
}
