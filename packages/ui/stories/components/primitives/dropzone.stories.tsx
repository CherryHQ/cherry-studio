import { Dropzone, DropzoneContent, DropzoneEmptyState } from '@cherrystudio/ui'
import type { Meta, StoryObj } from '@storybook/react'
import { useState } from 'react'

const meta: Meta<typeof Dropzone> = {
  title: 'Components/Primitives/Dropzone',
  component: Dropzone,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'A drag-and-drop file uploader built on `react-dropzone`. Compose with `DropzoneEmptyState` and `DropzoneContent` to render empty/populated states.'
      }
    }
  },
  tags: ['autodocs']
}

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: function DefaultExample() {
    const [files, setFiles] = useState<File[] | undefined>(undefined)
    return (
      <div className="w-96">
        <Dropzone
          src={files}
          onDrop={(accepted) => setFiles(accepted)}
          accept={{ 'image/*': [] }}
          maxSize={5 * 1024 * 1024}>
          <DropzoneEmptyState />
          <DropzoneContent />
        </Dropzone>
      </div>
    )
  }
}

export const MultipleFiles: Story = {
  render: function MultipleExample() {
    const [files, setFiles] = useState<File[] | undefined>(undefined)
    return (
      <div className="w-96">
        <Dropzone
          src={files}
          onDrop={(accepted) => setFiles(accepted)}
          maxFiles={5}
          accept={{ 'image/*': [], 'application/pdf': [] }}
          maxSize={10 * 1024 * 1024}>
          <DropzoneEmptyState />
          <DropzoneContent />
        </Dropzone>
      </div>
    )
  }
}

export const Disabled: Story = {
  render: () => (
    <div className="w-96">
      <Dropzone disabled>
        <DropzoneEmptyState />
        <DropzoneContent />
      </Dropzone>
    </div>
  )
}

export const CustomContent: Story = {
  render: function CustomExample() {
    const [files, setFiles] = useState<File[] | undefined>(undefined)
    return (
      <div className="w-96">
        <Dropzone src={files} onDrop={(accepted) => setFiles(accepted)}>
          <DropzoneEmptyState>
            <div className="flex flex-col items-center justify-center gap-1">
              <span className="text-sm font-medium">Drop your avatar here</span>
              <span className="text-xs text-muted-foreground">PNG or JPG, up to 2MB</span>
            </div>
          </DropzoneEmptyState>
          <DropzoneContent>
            {files && (
              <div className="flex flex-col items-center gap-1">
                <span className="text-sm font-medium">{files.length} file(s) selected</span>
                <span className="text-xs text-muted-foreground">Click to replace</span>
              </div>
            )}
          </DropzoneContent>
        </Dropzone>
      </div>
    )
  }
}
