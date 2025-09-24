import type { Meta, StoryObj } from '@storybook/react'

import MaxContextCount from '../../../src/components/display/MaxContextCount'

const meta: Meta<typeof MaxContextCount> = {
  title: 'Display/MaxContextCount',
  component: MaxContextCount,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: '一个用于显示最大上下文数量的组件。当数量达到100时显示无限符号，否则显示具体数字。'
      }
    }
  },
  tags: ['autodocs'],
  argTypes: {
    maxContext: {
      control: { type: 'number', min: 0, max: 100, step: 1 },
      description: '最大上下文数量。当值为100时显示无限符号(∞)，其他值显示具体数字。'
    },
    size: {
      control: { type: 'number', min: 8, max: 48, step: 2 },
      description: '图标大小，默认为14像素'
    },
    className: {
      control: { type: 'text' },
      description: '自定义 CSS 类名'
    },
    style: {
      control: { type: 'object' },
      description: '自定义样式对象'
    }
  },
  args: {
    maxContext: 10,
    size: 14
  }
} satisfies Meta<typeof MaxContextCount>

export default meta
type Story = StoryObj<typeof meta>

// 默认数字显示
export const Default: Story = {
  args: {
    maxContext: 10
  },
  render: (args) => (
    <div className="p-4 border border-gray-200 dark:border-gray-700 rounded inline-flex items-center gap-2">
      <span className="text-sm">最大上下文：</span>
      <MaxContextCount {...args} />
    </div>
  )
}

// 无限符号显示
export const InfinitySymbol: Story = {
  args: {
    maxContext: 100
  },
  render: (args) => (
    <div className="p-4 border border-gray-200 dark:border-gray-700 rounded inline-flex items-center gap-2">
      <span className="text-sm">最大上下文：</span>
      <MaxContextCount {...args} />
    </div>
  )
}

// 不同的数值范围
export const DifferentValues: Story = {
  render: () => (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="p-3 border border-gray-200 dark:border-gray-700 rounded">
          <div className="text-xs text-gray-500 mb-2">小数值</div>
          <div className="flex items-center gap-2">
            <span className="text-sm">上下文：</span>
            <MaxContextCount maxContext={5} />
          </div>
        </div>

        <div className="p-3 border border-gray-200 dark:border-gray-700 rounded">
          <div className="text-xs text-gray-500 mb-2">中等数值</div>
          <div className="flex items-center gap-2">
            <span className="text-sm">上下文：</span>
            <MaxContextCount maxContext={25} />
          </div>
        </div>

        <div className="p-3 border border-gray-200 dark:border-gray-700 rounded">
          <div className="text-xs text-gray-500 mb-2">大数值</div>
          <div className="flex items-center gap-2">
            <span className="text-sm">上下文：</span>
            <MaxContextCount maxContext={99} />
          </div>
        </div>

        <div className="p-3 border border-gray-200 dark:border-gray-700 rounded">
          <div className="text-xs text-gray-500 mb-2">无限</div>
          <div className="flex items-center gap-2">
            <span className="text-sm">上下文：</span>
            <MaxContextCount maxContext={100} />
          </div>
        </div>
      </div>
    </div>
  )
}

// 不同大小
export const DifferentSizes: Story = {
  render: () => (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <span className="text-xs">小号 (12px)：</span>
          <MaxContextCount maxContext={20} size={12} />
        </div>
      </div>

      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <span className="text-sm">默认 (14px)：</span>
          <MaxContextCount maxContext={50} size={14} />
        </div>
      </div>

      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <span className="text-base">中号 (18px)：</span>
          <MaxContextCount maxContext={75} size={18} />
        </div>
      </div>

      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <span className="text-lg">大号 (24px)：</span>
          <MaxContextCount maxContext={100} size={24} />
        </div>
      </div>
    </div>
  )
}

// 无限符号不同大小对比
export const InfinityDifferentSizes: Story = {
  render: () => (
    <div className="space-y-4">
      <h3 className="text-sm font-medium">无限符号不同大小对比</h3>
      <div className="flex items-center gap-6">
        <div className="flex items-center gap-2">
          <span className="text-xs">12px：</span>
          <MaxContextCount maxContext={100} size={12} />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm">16px：</span>
          <MaxContextCount maxContext={100} size={16} />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-base">20px：</span>
          <MaxContextCount maxContext={100} size={20} />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-lg">28px：</span>
          <MaxContextCount maxContext={100} size={28} />
        </div>
      </div>
    </div>
  )
}

// 自定义样式
export const CustomStyles: Story = {
  render: () => (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <span className="text-sm">红色数字：</span>
        <MaxContextCount maxContext={42} style={{ color: '#ef4444', fontWeight: 'bold' }} />
      </div>

      <div className="flex items-center gap-4">
        <span className="text-sm">蓝色无限符号：</span>
        <MaxContextCount maxContext={100} size={18} style={{ color: '#3b82f6' }} />
      </div>

      <div className="flex items-center gap-4">
        <span className="text-sm">带背景：</span>
        <MaxContextCount
          maxContext={88}
          className="px-2 py-1 bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200 rounded-full text-xs font-medium"
        />
      </div>

      <div className="flex items-center gap-4">
        <span className="text-sm">带边框：</span>
        <MaxContextCount
          maxContext={100}
          size={16}
          className="p-1 border-2 border-purple-300 rounded-full text-purple-600"
        />
      </div>
    </div>
  )
}

// 在实际使用场景中的展示
export const InRealScenarios: Story = {
  render: () => (
    <div className="space-y-4 max-w-md">
      <div className="p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
        <div className="flex items-center justify-between mb-2">
          <span className="font-medium text-sm">AI 模型配置</span>
        </div>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-gray-600 dark:text-gray-400">模型：</span>
            <span>GPT-4</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-600 dark:text-gray-400">温度：</span>
            <span>0.7</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-gray-600 dark:text-gray-400">最大上下文：</span>
            <MaxContextCount maxContext={100} />
          </div>
        </div>
      </div>

      <div className="p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
        <div className="flex items-center justify-between mb-2">
          <span className="font-medium text-sm">对话设置</span>
        </div>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between items-center">
            <span className="text-gray-600 dark:text-gray-400">记忆长度：</span>
            <MaxContextCount maxContext={50} size={13} />
          </div>
          <div className="flex justify-between items-center">
            <span className="text-gray-600 dark:text-gray-400">历史消息：</span>
            <MaxContextCount maxContext={20} size={13} />
          </div>
        </div>
      </div>
    </div>
  )
}

// 边界值测试
export const EdgeCases: Story = {
  render: () => (
    <div className="space-y-4">
      <h3 className="text-sm font-medium">边界值测试</h3>
      <div className="grid grid-cols-3 gap-4">
        <div className="p-3 border border-gray-200 dark:border-gray-700 rounded text-center">
          <div className="text-xs text-gray-500 mb-2">零值</div>
          <MaxContextCount maxContext={0} />
        </div>

        <div className="p-3 border border-gray-200 dark:border-gray-700 rounded text-center">
          <div className="text-xs text-gray-500 mb-2">临界值 99</div>
          <MaxContextCount maxContext={99} />
        </div>

        <div className="p-3 border border-gray-200 dark:border-gray-700 rounded text-center">
          <div className="text-xs text-gray-500 mb-2">临界值 100</div>
          <MaxContextCount maxContext={100} />
        </div>
      </div>
    </div>
  )
}

// 深色主题下的表现
export const DarkTheme: Story = {
  parameters: {
    backgrounds: { default: 'dark' }
  },
  render: () => (
    <div className="space-y-4 p-4 bg-gray-900 rounded-lg">
      <h3 className="text-sm font-medium text-white">深色主题下的表现</h3>
      <div className="space-y-3">
        <div className="flex items-center gap-4 text-gray-300">
          <span className="text-sm">普通数字：</span>
          <MaxContextCount maxContext={30} />
        </div>
        <div className="flex items-center gap-4 text-gray-300">
          <span className="text-sm">无限符号：</span>
          <MaxContextCount maxContext={100} size={16} />
        </div>
        <div className="flex items-center gap-4 text-gray-300">
          <span className="text-sm">自定义颜色：</span>
          <MaxContextCount maxContext={100} size={18} style={{ color: '#60a5fa' }} />
        </div>
      </div>
    </div>
  )
}
