import type { Meta, StoryObj } from '@storybook/react'

import { SuccessTag } from '../../../src/components/base/SuccessTag'

const meta: Meta<typeof SuccessTag> = {
  title: 'Base/SuccessTag',
  component: SuccessTag,
  parameters: {
    layout: 'centered'
  },
  tags: ['autodocs'],
  argTypes: {
    iconSize: { control: { type: 'range', min: 10, max: 24, step: 1 } },
    message: { control: 'text' }
  }
}

export default meta
type Story = StoryObj<typeof meta>

// Default
export const Default: Story = {
  args: {
    message: 'Success'
  }
}

// Different Messages
export const DifferentMessages: Story = {
  render: () => (
    <div className="flex flex-col gap-3">
      <SuccessTag message="Operation completed" />
      <SuccessTag message="File saved successfully" />
      <SuccessTag message="Data uploaded" />
      <SuccessTag message="Connection established" />
      <SuccessTag message="Task finished" />
    </div>
  )
}

// Different Icon Sizes
export const IconSizes: Story = {
  render: () => (
    <div className="flex items-center gap-4">
      <SuccessTag iconSize={10} message="Small icon" />
      <SuccessTag iconSize={14} message="Default icon" />
      <SuccessTag iconSize={18} message="Large icon" />
      <SuccessTag iconSize={24} message="Extra large icon" />
    </div>
  )
}

// In Context
export const InContext: Story = {
  render: () => (
    <div className="space-y-4">
      <div className="rounded-lg border border-gray-200 p-4">
        <h3 className="mb-2 font-semibold">Form Submission</h3>
        <p className="mb-3 text-sm text-gray-600">Your form has been processed.</p>
        <SuccessTag message="Form submitted successfully" />
      </div>

      <div className="rounded-lg border border-gray-200 p-4">
        <h3 className="mb-2 font-semibold">File Upload</h3>
        <div className="mb-2 space-y-2">
          <div className="text-sm">document.pdf</div>
          <div className="text-sm">image.png</div>
          <div className="text-sm">data.csv</div>
        </div>
        <SuccessTag message="3 files uploaded" />
      </div>

      <div className="rounded-lg border border-gray-200 p-4">
        <h3 className="mb-2 font-semibold">System Status</h3>
        <div className="space-y-2">
          <SuccessTag message="All systems operational" />
          <SuccessTag message="Database connected" />
          <SuccessTag message="API responding" />
        </div>
      </div>
    </div>
  )
}

// Use Cases
export const UseCases: Story = {
  render: () => (
    <div className="grid grid-cols-2 gap-4">
      <div className="space-y-2">
        <h4 className="font-medium">Actions</h4>
        <div className="space-y-2">
          <SuccessTag message="Saved" />
          <SuccessTag message="Published" />
          <SuccessTag message="Deployed" />
          <SuccessTag message="Synced" />
        </div>
      </div>

      <div className="space-y-2">
        <h4 className="font-medium">States</h4>
        <div className="space-y-2">
          <SuccessTag message="Active" />
          <SuccessTag message="Online" />
          <SuccessTag message="Ready" />
          <SuccessTag message="Verified" />
        </div>
      </div>
    </div>
  )
}
