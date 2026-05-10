import { ImagePreviewDialog, type ImagePreviewItem, ImagePreviewTrigger } from '@cherrystudio/ui'
import type { Meta, StoryObj } from '@storybook/react'
import { Copy, Download } from 'lucide-react'
import * as React from 'react'

const ITEMS: ImagePreviewItem[] = [
  {
    alt: 'Mint gradient preview',
    id: 'mint',
    src: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="900" height="600" viewBox="0 0 900 600"%3E%3Cdefs%3E%3ClinearGradient id="g" x1="0" x2="1" y1="0" y2="1"%3E%3Cstop stop-color="%230fb981"/%3E%3Cstop offset="1" stop-color="%231c7ed6"/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect fill="url(%23g)" width="900" height="600"/%3E%3Ccircle cx="230" cy="230" r="120" fill="%23ffffff55"/%3E%3Crect x="430" y="190" width="260" height="210" rx="24" fill="%2300000033"/%3E%3C/svg%3E'
  },
  {
    alt: 'Rose gradient preview',
    id: 'rose',
    src: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="900" height="600" viewBox="0 0 900 600"%3E%3Cdefs%3E%3ClinearGradient id="g" x1="0" x2="1" y1="0" y2="1"%3E%3Cstop stop-color="%23f43f5e"/%3E%3Cstop offset="1" stop-color="%23f59e0b"/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect fill="url(%23g)" width="900" height="600"/%3E%3Crect x="140" y="120" width="620" height="360" rx="36" fill="%23ffffff44"/%3E%3Ccircle cx="580" cy="300" r="96" fill="%2300000026"/%3E%3C/svg%3E'
  }
]

const labels = {
  close: 'Close preview',
  dialogTitle: 'Image preview',
  flipHorizontal: 'Flip horizontal',
  flipVertical: 'Flip vertical',
  next: 'Next image',
  previous: 'Previous image',
  reset: 'Reset',
  rotateLeft: 'Rotate left',
  rotateRight: 'Rotate right',
  zoomIn: 'Zoom in',
  zoomOut: 'Zoom out'
}

const meta: Meta<typeof ImagePreviewDialog> = {
  title: 'Components/Composites/ImagePreview',
  component: ImagePreviewDialog,
  parameters: {
    layout: 'fullscreen'
  },
  tags: ['autodocs']
}

export default meta
type Story = StoryObj<typeof meta>

const ControlledDialogDemo = () => {
  const [open, setOpen] = React.useState(true)
  const [activeIndex, setActiveIndex] = React.useState(0)

  return (
    <ImagePreviewDialog
      activeIndex={activeIndex}
      items={ITEMS}
      labels={labels}
      onActiveIndexChange={setActiveIndex}
      onOpenChange={setOpen}
      open={open}
      renderMetadata={(item, context) => (
        <div className="text-center text-muted-foreground text-sm">
          {context.index + 1} / {context.items.length} · {item.alt}
        </div>
      )}
    />
  )
}

export const Trigger: Story = {
  render: () => (
    <div className="flex h-screen items-center justify-center bg-background">
      <ImagePreviewTrigger
        className="h-40 w-60 cursor-pointer rounded-md object-cover shadow-sm"
        dialogProps={{
          actions: [
            { id: 'copy-src', label: 'Copy source', icon: <Copy className="size-4" />, onSelect: () => undefined }
          ],
          labels,
          toolbarActions: [
            { id: 'download', label: 'Download', icon: <Download className="size-4" />, onSelect: () => undefined }
          ]
        }}
        item={ITEMS[0]}
        items={ITEMS}
      />
    </div>
  )
}

export const ControlledDialog: Story = {
  render: () => <ControlledDialogDemo />
}
