import { ImageToolButton } from '@cherrystudio/ui'
import type { Meta, StoryObj } from '@storybook/react'
import { Copy, Download, Maximize2, RotateCw, Trash2, ZoomIn, ZoomOut } from 'lucide-react'

const meta: Meta<typeof ImageToolButton> = {
  title: 'Components/Composites/ImageToolButton',
  component: ImageToolButton,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'A round tooltip-wrapped icon button used in the image preview toolbar. Provide an `icon`, a `tooltip`, and an `onPress` handler.'
      }
    }
  },
  tags: ['autodocs']
}

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: () => <ImageToolButton tooltip="Download" icon={<Download size={16} />} onPress={() => undefined} />
}

export const Toolbar: Story = {
  render: () => (
    <div className="flex items-center gap-2 rounded-full bg-muted/40 p-2 shadow-sm">
      <ImageToolButton tooltip="Zoom in" icon={<ZoomIn size={16} />} onPress={() => undefined} />
      <ImageToolButton tooltip="Zoom out" icon={<ZoomOut size={16} />} onPress={() => undefined} />
      <ImageToolButton tooltip="Rotate" icon={<RotateCw size={16} />} onPress={() => undefined} />
      <ImageToolButton tooltip="Fullscreen" icon={<Maximize2 size={16} />} onPress={() => undefined} />
      <ImageToolButton tooltip="Copy" icon={<Copy size={16} />} onPress={() => undefined} />
      <ImageToolButton tooltip="Delete" icon={<Trash2 size={16} />} onPress={() => undefined} />
    </div>
  )
}
