import { Button, ConfirmDialog } from '@cherrystudio/ui'
import type { Meta, StoryObj } from '@storybook/react'
import { useState } from 'react'

const meta: Meta<typeof ConfirmDialog> = {
  title: 'Components/Composites/ConfirmDialog',
  component: ConfirmDialog,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'A pre-composed confirm dialog component that combines Dialog, Button, and other primitives for quick confirmation scenarios.'
      }
    }
  },
  tags: ['autodocs'],
  argTypes: {
    title: {
      control: { type: 'text' },
      description: 'Dialog title'
    },
    description: {
      control: { type: 'text' },
      description: 'Dialog description'
    },
    confirmText: {
      control: { type: 'text' },
      description: 'Confirm button text'
    },
    cancelText: {
      control: { type: 'text' },
      description: 'Cancel button text'
    },
    destructive: {
      control: { type: 'boolean' },
      description: 'Whether this is a destructive action'
    },
    confirmLoading: {
      control: { type: 'boolean' },
      description: 'Loading state for confirm button'
    }
  }
}

export default meta
type Story = StoryObj<typeof meta>

function DefaultDemo() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button onClick={() => setOpen(true)}>Open Dialog</Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Confirm Action"
        description="Are you sure you want to proceed with this action?"
        onConfirm={() => console.log('Confirmed')}
      />
    </>
  )
}

export const Default: Story = {
  render: () => <DefaultDemo />
}

function DestructiveDemo() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button variant="destructive" onClick={() => setOpen(true)}>
        Delete Item
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Delete Item"
        description="This action cannot be undone. This will permanently delete the item."
        destructive
        confirmText="Delete"
        onConfirm={() => console.log('Deleted')}
      />
    </>
  )
}

export const Destructive: Story = {
  render: () => <DestructiveDemo />
}

function WithLoadingDemo() {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)

  const handleConfirm = async () => {
    setLoading(true)
    await new Promise((resolve) => setTimeout(resolve, 2000))
    setLoading(false)
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>Save Changes</Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Save Changes"
        description="Do you want to save your changes?"
        confirmText="Save"
        confirmLoading={loading}
        onConfirm={handleConfirm}
      />
    </>
  )
}

export const WithLoading: Story = {
  render: () => <WithLoadingDemo />
}

function WithCustomContentDemo() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        Export Data
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Export Data"
        description="Select the format for your export:"
        content={
          <div className="flex flex-col gap-2 py-2">
            <label className="flex items-center gap-2">
              <input type="radio" name="format" defaultChecked />
              <span className="text-sm">CSV</span>
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" name="format" />
              <span className="text-sm">JSON</span>
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" name="format" />
              <span className="text-sm">Excel</span>
            </label>
          </div>
        }
        confirmText="Export"
        onConfirm={() => console.log('Exported')}
      />
    </>
  )
}

export const WithCustomContent: Story = {
  render: () => <WithCustomContentDemo />
}

function CustomButtonTextDemo() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button onClick={() => setOpen(true)}>Logout</Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Logout"
        description="Are you sure you want to logout?"
        confirmText="Yes, Logout"
        cancelText="Stay Logged In"
        onConfirm={() => console.log('Logged out')}
      />
    </>
  )
}

export const CustomButtonText: Story = {
  render: () => <CustomButtonTextDemo />
}
