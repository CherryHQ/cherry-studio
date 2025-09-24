import type { Meta, StoryObj } from '@storybook/react'

import { ErrorTag, InfoTag, StatusTag, SuccessTag, WarnTag } from '../../../src/components/base/StatusTag'

const meta: Meta<typeof StatusTag> = {
  title: 'Base/StatusTag',
  component: StatusTag,
  parameters: {
    layout: 'centered'
  },
  tags: ['autodocs'],
  argTypes: {
    type: {
      control: { type: 'select' },
      options: ['success', 'error', 'warning', 'info']
    },
    iconSize: { control: { type: 'range', min: 10, max: 24, step: 1 } },
    message: { control: 'text' },
    color: { control: 'color' }
  }
}

export default meta
type Story = StoryObj<typeof meta>

// Default
export const Default: Story = {
  args: {
    type: 'success',
    message: 'Success'
  }
}

// All Types
export const AllTypes: Story = {
  render: () => (
    <div className="flex flex-col gap-3">
      <StatusTag type="success" message="Success message" />
      <StatusTag type="error" message="Error message" />
      <StatusTag type="warning" message="Warning message" />
      <StatusTag type="info" message="Info message" />
    </div>
  )
}

// Convenience Components
export const ConvenienceComponents: Story = {
  render: () => (
    <div className="flex flex-col gap-3">
      <SuccessTag message="Operation completed" />
      <ErrorTag message="Operation failed" />
      <WarnTag message="Please check this" />
      <InfoTag message="Additional information" />
    </div>
  )
}

// Different Icon Sizes
export const IconSizes: Story = {
  render: () => (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <StatusTag type="success" iconSize={10} message="Small icon" />
        <StatusTag type="success" iconSize={14} message="Default icon" />
        <StatusTag type="success" iconSize={18} message="Large icon" />
        <StatusTag type="success" iconSize={24} message="Extra large icon" />
      </div>
      <div className="flex items-center gap-4">
        <ErrorTag iconSize={10} message="Small icon" />
        <ErrorTag iconSize={14} message="Default icon" />
        <ErrorTag iconSize={18} message="Large icon" />
        <ErrorTag iconSize={24} message="Extra large icon" />
      </div>
    </div>
  )
}

// Custom Colors
export const CustomColors: Story = {
  render: () => (
    <div className="flex flex-col gap-3">
      <StatusTag type="success" message="Custom purple" color="#8B5CF6" />
      <StatusTag type="error" message="Custom blue" color="#3B82F6" />
      <StatusTag type="warning" message="Custom green" color="#10B981" />
      <StatusTag type="info" message="Custom pink" color="#EC4899" />
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
        <h3 className="mb-2 font-semibold">Validation Error</h3>
        <p className="mb-3 text-sm text-gray-600">Please fix the following issues:</p>
        <ErrorTag message="Invalid email format" />
      </div>

      <div className="rounded-lg border border-gray-200 p-4">
        <h3 className="mb-2 font-semibold">System Status</h3>
        <div className="space-y-2">
          <SuccessTag message="Database connected" />
          <WarnTag message="High memory usage" />
          <ErrorTag message="Email service down" />
          <InfoTag message="Last backup: 2 hours ago" />
        </div>
      </div>
    </div>
  )
}

// Use Cases
export const UseCases: Story = {
  render: () => (
    <div className="grid grid-cols-2 gap-6">
      <div className="space-y-2">
        <h4 className="font-medium">Success States</h4>
        <div className="space-y-2">
          <SuccessTag message="Saved" />
          <SuccessTag message="Published" />
          <SuccessTag message="Deployed" />
          <SuccessTag message="Verified" />
        </div>
      </div>

      <div className="space-y-2">
        <h4 className="font-medium">Error States</h4>
        <div className="space-y-2">
          <ErrorTag message="Failed" />
          <ErrorTag message="Timeout" />
          <ErrorTag message="Not found" />
          <ErrorTag message="Access denied" />
        </div>
      </div>

      <div className="space-y-2">
        <h4 className="font-medium">Warning States</h4>
        <div className="space-y-2">
          <WarnTag message="Deprecated" />
          <WarnTag message="Limited" />
          <WarnTag message="Expiring soon" />
          <WarnTag message="Low balance" />
        </div>
      </div>

      <div className="space-y-2">
        <h4 className="font-medium">Info States</h4>
        <div className="space-y-2">
          <InfoTag message="New" />
          <InfoTag message="Beta" />
          <InfoTag message="Preview" />
          <InfoTag message="Optional" />
        </div>
      </div>
    </div>
  )
}

// Long Messages
export const LongMessages: Story = {
  render: () => (
    <div className="max-w-md space-y-3">
      <SuccessTag message="Your request has been successfully processed and saved to the database" />
      <ErrorTag message="Unable to connect to the server. Please check your network connection and try again" />
      <WarnTag message="This feature will be deprecated in the next major version. Please migrate to the new API" />
      <InfoTag message="Additional information about this feature can be found in the documentation at docs.example.com" />
    </div>
  )
}
