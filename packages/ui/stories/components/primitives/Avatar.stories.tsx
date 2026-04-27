import { Avatar, AvatarBadge, AvatarFallback, AvatarGroup, AvatarGroupCount, AvatarImage } from '@cherrystudio/ui'
import type { Meta, StoryObj } from '@storybook/react'
import { Bot, User } from 'lucide-react'

const meta: Meta<typeof Avatar> = {
  title: 'Components/Primitives/Avatar',
  component: Avatar,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'Avatar displays a user or entity image with optional fallback, badge, and grouping. Supports `sm`, `default`, and `lg` sizes.'
      }
    }
  },
  tags: ['autodocs'],
  argTypes: {
    size: {
      control: { type: 'radio' },
      options: ['sm', 'default', 'lg']
    }
  }
}

export default meta
type Story = StoryObj<typeof meta>

const sampleImage = 'https://github.com/shadcn.png'

export const Default: Story = {
  render: () => (
    <Avatar>
      <AvatarImage src={sampleImage} alt="@shadcn" />
      <AvatarFallback>CN</AvatarFallback>
    </Avatar>
  )
}

export const Sizes: Story = {
  render: () => (
    <div className="flex items-end gap-4">
      <div className="flex flex-col items-center gap-2">
        <Avatar size="sm">
          <AvatarImage src={sampleImage} alt="small" />
          <AvatarFallback>SM</AvatarFallback>
        </Avatar>
        <span className="text-xs text-muted-foreground">sm</span>
      </div>
      <div className="flex flex-col items-center gap-2">
        <Avatar>
          <AvatarImage src={sampleImage} alt="default" />
          <AvatarFallback>MD</AvatarFallback>
        </Avatar>
        <span className="text-xs text-muted-foreground">default</span>
      </div>
      <div className="flex flex-col items-center gap-2">
        <Avatar size="lg">
          <AvatarImage src={sampleImage} alt="large" />
          <AvatarFallback>LG</AvatarFallback>
        </Avatar>
        <span className="text-xs text-muted-foreground">lg</span>
      </div>
    </div>
  )
}

export const FallbackOnly: Story = {
  render: () => (
    <div className="flex items-center gap-4">
      <Avatar>
        <AvatarFallback>JD</AvatarFallback>
      </Avatar>
      <Avatar>
        <AvatarFallback>
          <User className="size-4" />
        </AvatarFallback>
      </Avatar>
      <Avatar>
        <AvatarFallback className="bg-primary text-primary-foreground">AI</AvatarFallback>
      </Avatar>
    </div>
  )
}

export const WithBadge: Story = {
  render: () => (
    <div className="flex items-center gap-6">
      <Avatar>
        <AvatarImage src={sampleImage} alt="online" />
        <AvatarFallback>ON</AvatarFallback>
        <AvatarBadge className="bg-green-500" />
      </Avatar>
      <Avatar size="lg">
        <AvatarImage src={sampleImage} alt="bot" />
        <AvatarFallback>BT</AvatarFallback>
        <AvatarBadge>
          <Bot />
        </AvatarBadge>
      </Avatar>
      <Avatar size="sm">
        <AvatarFallback>OF</AvatarFallback>
        <AvatarBadge className="bg-muted-foreground" />
      </Avatar>
    </div>
  )
}

export const Group: Story = {
  render: () => (
    <div className="flex flex-col gap-6">
      <AvatarGroup>
        <Avatar>
          <AvatarImage src={sampleImage} alt="user 1" />
          <AvatarFallback>A</AvatarFallback>
        </Avatar>
        <Avatar>
          <AvatarFallback>B</AvatarFallback>
        </Avatar>
        <Avatar>
          <AvatarFallback>C</AvatarFallback>
        </Avatar>
        <AvatarGroupCount>+5</AvatarGroupCount>
      </AvatarGroup>

      <div data-size="lg" className="group">
        <AvatarGroup>
          <Avatar size="lg">
            <AvatarImage src={sampleImage} alt="big user" />
            <AvatarFallback>X</AvatarFallback>
          </Avatar>
          <Avatar size="lg">
            <AvatarFallback>Y</AvatarFallback>
          </Avatar>
          <Avatar size="lg">
            <AvatarFallback>Z</AvatarFallback>
          </Avatar>
        </AvatarGroup>
      </div>
    </div>
  )
}
