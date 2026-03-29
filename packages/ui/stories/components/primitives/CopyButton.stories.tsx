import type { Meta, StoryObj } from '@storybook/react'

import { CopyButton } from '../../../src/components'

const meta: Meta<typeof CopyButton> = {
  title: 'Components/Primitives/CopyButton',
  component: CopyButton,
  parameters: {
    layout: 'centered'
  },
  tags: ['autodocs'],
  argTypes: {
    tooltip: {
      control: 'text',
      description: '悬停时显示的提示文字'
    },
    label: {
      control: 'text',
      description: '复制按钮的标签文字'
    },
    size: {
      control: { type: 'range', min: 10, max: 30, step: 1 },
      description: '图标和文字的大小'
    },
    className: {
      control: 'text',
      description: '自定义 CSS 类名'
    }
  }
}

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: {}
}

export const WithTooltip: Story = {
  args: {
    tooltip: '点击复制'
  }
}

export const WithLabel: Story = {
  args: {
    label: '复制'
  }
}

export const WithTooltipAndLabel: Story = {
  args: {
    tooltip: '点击复制内容到剪贴板',
    label: '复制内容'
  }
}

export const SmallSize: Story = {
  args: {
    size: 12,
    label: '小尺寸',
    tooltip: '小尺寸复制按钮'
  }
}

export const LargeSize: Story = {
  args: {
    size: 20,
    label: '大尺寸',
    tooltip: '大尺寸复制按钮'
  }
}

export const CustomStyle: Story = {
  args: {
    label: '自定义样式',
    tooltip: '自定义样式的复制按钮',
    className: 'bg-blue-50 dark:bg-blue-900/20 p-2 rounded-lg border-2 border-blue-200 dark:border-blue-700'
  }
}

export const OnlyIcon: Story = {
  args: {
    tooltip: '仅图标模式',
    size: 16
  }
}

export const Interactive: Story = {
  args: {
    tooltip: '可交互的复制按钮',
    label: '点击复制'
  },
  render: (args) => (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-medium mb-2">不同状态的复制按钮:</h3>
        <div className="space-y-2">
          <div>
            <CopyButton {...args} onClick={() => alert('已复制!')} />
          </div>
          <div>
            <CopyButton tooltip="禁用状态" label="禁用" className="opacity-50 pointer-events-none" />
          </div>
        </div>
      </div>
    </div>
  )
}

export const MultipleButtons: Story = {
  render: () => (
    <div className="space-y-4">
      <h3 className="text-sm font-medium mb-2">多个复制按钮组合:</h3>
      <div className="flex flex-wrap gap-4">
        <CopyButton tooltip="复制代码" label="代码" size={14} />
        <CopyButton tooltip="复制链接" label="链接" size={14} />
        <CopyButton tooltip="复制文本" label="文本" size={14} />
        <CopyButton tooltip="复制JSON" label="JSON" size={14} />
      </div>
    </div>
  )
}
