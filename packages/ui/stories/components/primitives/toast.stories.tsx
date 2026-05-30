import { Button, getToastUtilities, ToastViewport } from '@cherrystudio/ui'
import type { Meta, StoryObj } from '@storybook/react'

const toast = getToastUtilities()

const meta: Meta<typeof ToastViewport> = {
  title: 'Components/Primitives/Toast',
  component: ToastViewport,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: 'A shared toast viewport and utility API for app-wide feedback messages.'
      }
    }
  },
  tags: ['autodocs']
}

export default meta
type Story = StoryObj<typeof meta>

export const Basic: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-2">
      <ToastViewport />
      <Button onClick={() => toast.success('Settings saved')}>Success</Button>
      <Button variant="outline" onClick={() => toast.info('Sync started')}>
        Info
      </Button>
      <Button variant="outline" onClick={() => toast.warning('Storage is almost full')}>
        Warning
      </Button>
      <Button variant="destructive" onClick={() => toast.error('Upload failed')}>
        Error
      </Button>
    </div>
  )
}

export const WithDescription: Story = {
  render: () => (
    <div className="flex items-center gap-2">
      <ToastViewport />
      <Button
        onClick={() =>
          toast.success({
            description: 'Your changes are now available across open windows.',
            title: 'Profile updated'
          })
        }>
        Show toast
      </Button>
    </div>
  )
}

export const Loading: Story = {
  render: () => (
    <div className="flex items-center gap-2">
      <ToastViewport />
      <Button
        onClick={() =>
          toast.loading({
            promise: new Promise((resolve) => setTimeout(resolve, 1200)),
            title: 'Generating summary'
          })
        }>
        Start loading
      </Button>
    </div>
  )
}
