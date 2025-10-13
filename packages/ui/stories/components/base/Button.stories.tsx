import type { Meta, StoryObj } from '@storybook/react'

import { Button } from '../../../src/components'

const meta: Meta<typeof Button> = {
  title: 'Components/Base/Button',
  component: Button,
  parameters: {
    layout: 'centered'
  },
  tags: ['autodocs'],
  argTypes: {
    variant: {
      control: { type: 'select' },
      options: ['solid', 'bordered', 'light', 'flat', 'faded', 'shadow', 'ghost']
    },
    color: {
      control: { type: 'select' },
      options: ['default', 'primary', 'secondary', 'success', 'warning', 'danger']
    },
    size: {
      control: { type: 'select' },
      options: ['sm', 'md', 'lg']
    },
    radius: {
      control: { type: 'select' },
      options: ['none', 'sm', 'md', 'lg', 'full']
    },
    isDisabled: {
      control: { type: 'boolean' }
    },
    isLoading: {
      control: { type: 'boolean' }
    },
    fullWidth: {
      control: { type: 'boolean' }
    },
    isIconOnly: {
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
      <Button variant="solid">Solid</Button>
      <Button variant="bordered">Bordered</Button>
      <Button variant="light">Light</Button>
      <Button variant="flat">Flat</Button>
      <Button variant="faded">Faded</Button>
      <Button variant="shadow">Shadow</Button>
      <Button variant="ghost">Ghost</Button>
    </div>
  )
}

// 不同颜色
export const Colors: Story = {
  render: () => (
    <div className="flex gap-2 flex-wrap">
      <Button color="default">Default</Button>
      <Button color="primary">Primary</Button>
      <Button color="secondary">Secondary</Button>
      <Button color="success">Success</Button>
      <Button color="warning">Warning</Button>
      <Button color="danger">Danger</Button>
    </div>
  )
}

// 不同尺寸
export const Sizes: Story = {
  render: () => (
    <div className="flex gap-2 items-center">
      <Button size="sm">Small</Button>
      <Button size="md">Medium</Button>
      <Button size="lg">Large</Button>
    </div>
  )
}

// 不同圆角
export const Radius: Story = {
  render: () => (
    <div className="flex gap-2 flex-wrap">
      <Button radius="none">None</Button>
      <Button radius="sm">Small</Button>
      <Button radius="md">Medium</Button>
      <Button radius="lg">Large</Button>
      <Button radius="full">Full</Button>
    </div>
  )
}

// 状态
export const States: Story = {
  render: () => (
    <div className="flex gap-2 flex-wrap">
      <Button>Normal</Button>
      <Button isDisabled>Disabled</Button>
      <Button isLoading>Loading</Button>
    </div>
  )
}

// 带图标
export const WithIcons: Story = {
  render: () => (
    <div className="flex gap-2 flex-wrap">
      <Button startContent={<span>📧</span>}>Email</Button>
      <Button endContent={<span>→</span>}>Next</Button>
      <Button isIconOnly>🔍</Button>
    </div>
  )
}

// 全宽按钮
export const FullWidth: Story = {
  render: () => (
    <div className="w-96">
      <Button fullWidth color="primary">
        Full Width Button
      </Button>
    </div>
  )
}

// 交互示例
export const Interactive: Story = {
  render: () => (
    <div className="flex gap-2 flex-wrap">
      <Button onPress={() => alert('Button pressed!')}>Click Me</Button>
      <Button onPress={() => console.log('Primary action')} color="primary" variant="solid">
        Primary Action
      </Button>
    </div>
  )
}
