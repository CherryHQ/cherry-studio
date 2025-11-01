import type { Meta, StoryObj } from '@storybook/react'

import { Button } from '../../../src/components'

const meta: Meta<typeof Button> = {
  title: 'Components/Primitives/Button',
  component: Button,
  parameters: {
    layout: 'centered'
  },
  tags: ['autodocs'],
  argTypes: {
    variant: {
      control: { type: 'select' },
      options: ['default', 'destructive', 'outline', 'secondary', 'ghost', 'link']
    },
    size: {
      control: { type: 'select' },
      options: ['default', 'sm', 'lg', 'icon', 'icon-sm', 'icon-lg']
    },
    disabled: {
      control: { type: 'boolean' }
    },
    asChild: {
      control: { type: 'boolean' }
    }
  }
}

export default meta
type Story = StoryObj<typeof meta>

// 基础按钮
export const Default: Story = {
  args: {
    children: 'Button'
  }
}

// 不同变体
export const Variants: Story = {
  render: () => (
    <div className="flex gap-2 flex-wrap">
      <Button variant="default">Default</Button>
      <Button variant="secondary">Secondary</Button>
      <Button variant="destructive">Destructive</Button>
      <Button variant="outline">Outline</Button>
      <Button variant="ghost">Ghost</Button>
      <Button variant="link">Link</Button>
    </div>
  )
}

// 不同尺寸
export const Sizes: Story = {
  render: () => (
    <div className="flex gap-2 items-center flex-wrap">
      <Button size="sm">Small</Button>
      <Button size="default">Default</Button>
      <Button size="lg">Large</Button>
    </div>
  )
}

// 图标按钮
export const IconButtons: Story = {
  render: () => (
    <div className="flex gap-2 items-center flex-wrap">
      <Button size="icon-sm">🔍</Button>
      <Button size="icon">🔍</Button>
      <Button size="icon-lg">🔍</Button>
    </div>
  )
}

// 状态
export const States: Story = {
  render: () => (
    <div className="flex gap-2 flex-wrap">
      <Button>Normal</Button>
      <Button disabled>Disabled</Button>
    </div>
  )
}

// 带图标
export const WithIcons: Story = {
  render: () => (
    <div className="flex gap-2 flex-wrap">
      <Button>
        <span className="mr-2">📧</span>
        Email
      </Button>
      <Button>
        Next
        <span className="ml-2">→</span>
      </Button>
      <Button size="icon">🔍</Button>
    </div>
  )
}

// 全宽按钮
export const FullWidth: Story = {
  render: () => (
    <div className="w-96">
      <Button className="w-full">Full Width Button</Button>
    </div>
  )
}

// 交互示例
export const Interactive: Story = {
  render: () => (
    <div className="flex gap-2 flex-wrap">
      <Button onClick={() => alert('Button clicked!')}>Click Me</Button>
      <Button onClick={() => console.log('Primary action')} variant="default">
        Primary Action
      </Button>
    </div>
  )
}

// 组合示例
export const Combinations: Story = {
  render: () => (
    <div className="flex flex-col gap-4">
      <div className="flex gap-2 flex-wrap">
        <Button variant="default" size="sm">
          Small Default
        </Button>
        <Button variant="destructive" size="sm">
          Small Destructive
        </Button>
        <Button variant="outline" size="sm">
          Small Outline
        </Button>
      </div>
      <div className="flex gap-2 flex-wrap">
        <Button variant="default">Default</Button>
        <Button variant="destructive">Destructive</Button>
        <Button variant="outline">Outline</Button>
      </div>
      <div className="flex gap-2 flex-wrap">
        <Button variant="default" size="lg">
          Large Default
        </Button>
        <Button variant="destructive" size="lg">
          Large Destructive
        </Button>
        <Button variant="outline" size="lg">
          Large Outline
        </Button>
      </div>
    </div>
  )
}
