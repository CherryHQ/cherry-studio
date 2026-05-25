import { Skeleton } from '@cherrystudio/ui'
import type { Meta, StoryObj } from '@storybook/react'

const meta: Meta<typeof Skeleton> = {
  title: 'Components/Primitives/Skeleton',
  component: Skeleton,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'A placeholder used while content is loading. Renders a pulsing gray block you can shape with Tailwind utilities.'
      }
    }
  },
  tags: ['autodocs']
}

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: () => <Skeleton className="h-4 w-48" />
}

export const CardSkeleton: Story = {
  render: () => (
    <div className="flex w-80 items-center gap-4 rounded-md border p-4">
      <Skeleton className="size-10 rounded-full" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-3 w-1/2" />
      </div>
    </div>
  )
}

export const ListSkeleton: Story = {
  render: () => (
    <div className="flex w-96 flex-col gap-3">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton className="size-9 rounded-md" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3.5 w-2/3" />
            <Skeleton className="h-3 w-1/3" />
          </div>
          <Skeleton className="h-8 w-16 rounded-md" />
        </div>
      ))}
    </div>
  )
}

export const Shapes: Story = {
  render: () => (
    <div className="flex items-end gap-4">
      <Skeleton className="size-12 rounded-full" />
      <Skeleton className="size-12 rounded-md" />
      <Skeleton className="h-12 w-24 rounded-sm" />
      <Skeleton className="h-12 w-12 rounded-none" />
    </div>
  )
}
