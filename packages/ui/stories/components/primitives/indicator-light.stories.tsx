import type { Meta, StoryObj } from '@storybook/react'

import { IndicatorLight } from '../../../src/components'

const meta: Meta<typeof IndicatorLight> = {
  title: 'Components/Primitives/IndicatorLight',
  component: IndicatorLight,
  parameters: {
    layout: 'centered'
  },
  tags: ['autodocs'],
  argTypes: {
    color: {
      control: 'color',
      description: '指示灯的颜色（支持预设颜色名称或十六进制值）'
    },
    size: {
      control: { type: 'range', min: 4, max: 32, step: 2 },
      description: '指示灯的大小（像素）'
    },
    shadow: {
      control: 'boolean',
      description: '是否显示发光阴影效果'
    },
    style: {
      control: false,
      description: '自定义样式对象'
    },
    animation: {
      control: 'boolean',
      description: '是否启用脉冲动画'
    }
  }
}

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: {
    color: 'green'
  }
}

export const Red: Story = {
  args: {
    color: '#ef4444'
  }
}

export const Blue: Story = {
  args: {
    color: '#3b82f6'
  }
}

export const Yellow: Story = {
  args: {
    color: '#eab308'
  }
}

export const Purple: Story = {
  args: {
    color: '#a855f7'
  }
}

export const Orange: Story = {
  args: {
    color: '#f97316'
  }
}

export const WithoutShadow: Story = {
  args: {
    color: 'green',
    shadow: false
  }
}

export const WithoutAnimation: Story = {
  args: {
    color: '#3b82f6',
    animation: false
  }
}

export const SmallSize: Story = {
  args: {
    color: '#ef4444',
    size: 6
  }
}

export const LargeSize: Story = {
  args: {
    color: '#22c55e',
    size: 24
  }
}

export const CustomStyle: Story = {
  args: {
    color: '#8b5cf6',
    size: 16,
    style: {
      border: '2px solid #8b5cf6',
      opacity: 0.8
    },
    className: 'ring-2 ring-purple-200 dark:ring-purple-800'
  }
}

export const StatusColors: Story = {
  render: () => (
    <div className="space-y-6">
      <h3 className="text-lg font-medium">状态指示颜色</h3>
      <div className="grid grid-cols-2 gap-4">
        <div className="flex items-center gap-3">
          <IndicatorLight color="#22c55e" />
          <span>在线/成功</span>
        </div>
        <div className="flex items-center gap-3">
          <IndicatorLight color="#ef4444" />
          <span>离线/错误</span>
        </div>
        <div className="flex items-center gap-3">
          <IndicatorLight color="#eab308" />
          <span>警告/等待</span>
        </div>
        <div className="flex items-center gap-3">
          <IndicatorLight color="#3b82f6" />
          <span>信息/处理中</span>
        </div>
        <div className="flex items-center gap-3">
          <IndicatorLight color="#6b7280" />
          <span>禁用/未知</span>
        </div>
        <div className="flex items-center gap-3">
          <IndicatorLight color="#a855f7" />
          <span>特殊状态</span>
        </div>
      </div>
    </div>
  )
}

export const SizeComparison: Story = {
  render: () => (
    <div className="space-y-6">
      <h3 className="text-lg font-medium">不同尺寸对比</h3>
      <div className="flex items-center gap-6">
        <div className="text-center">
          <IndicatorLight color="#22c55e" size={6} />
          <p className="text-xs mt-2">小 (6px)</p>
        </div>
        <div className="text-center">
          <IndicatorLight color="#22c55e" size={8} />
          <p className="text-xs mt-2">默认 (8px)</p>
        </div>
        <div className="text-center">
          <IndicatorLight color="#22c55e" size={12} />
          <p className="text-xs mt-2">中 (12px)</p>
        </div>
        <div className="text-center">
          <IndicatorLight color="#22c55e" size={16} />
          <p className="text-xs mt-2">大 (16px)</p>
        </div>
        <div className="text-center">
          <IndicatorLight color="#22c55e" size={24} />
          <p className="text-xs mt-2">特大 (24px)</p>
        </div>
      </div>
    </div>
  )
}

export const UserStatusList: Story = {
  render: () => (
    <div className="space-y-4">
      <h3 className="text-lg font-medium">用户状态列表</h3>
      <div className="space-y-3">
        <div className="flex items-center gap-3 p-3 border border-gray-200 dark:border-gray-700 rounded">
          <IndicatorLight color="#22c55e" size={10} />
          <div className="flex-1">
            <p className="font-medium">张三</p>
            <p className="text-sm text-gray-500">在线 - 5分钟前活跃</p>
          </div>
        </div>
        <div className="flex items-center gap-3 p-3 border border-gray-200 dark:border-gray-700 rounded">
          <IndicatorLight color="#eab308" size={10} />
          <div className="flex-1">
            <p className="font-medium">李四</p>
            <p className="text-sm text-gray-500">离开 - 30分钟前活跃</p>
          </div>
        </div>
        <div className="flex items-center gap-3 p-3 border border-gray-200 dark:border-gray-700 rounded">
          <IndicatorLight color="#ef4444" size={10} />
          <div className="flex-1">
            <p className="font-medium">王五</p>
            <p className="text-sm text-gray-500">离线 - 2小时前活跃</p>
          </div>
        </div>
        <div className="flex items-center gap-3 p-3 border border-gray-200 dark:border-gray-700 rounded">
          <IndicatorLight color="#3b82f6" size={10} />
          <div className="flex-1">
            <p className="font-medium">赵六</p>
            <p className="text-sm text-gray-500">忙碌 - 正在通话中</p>
          </div>
        </div>
      </div>
    </div>
  )
}

export const ServiceStatus: Story = {
  render: () => (
    <div className="space-y-4">
      <h3 className="text-lg font-medium">服务状态监控</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="p-4 border border-gray-200 dark:border-gray-700 rounded">
          <div className="flex items-center justify-between mb-3">
            <h4 className="font-medium">Web 服务器</h4>
            <IndicatorLight color="#22c55e" size={12} />
          </div>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            响应时间: 120ms
            <br />
            正常运行时间: 99.9%
          </p>
        </div>
        <div className="p-4 border border-gray-200 dark:border-gray-700 rounded">
          <div className="flex items-center justify-between mb-3">
            <h4 className="font-medium">数据库</h4>
            <IndicatorLight color="#eab308" size={12} />
          </div>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            响应时间: 250ms
            <br />
            正常运行时间: 98.5%
          </p>
        </div>
        <div className="p-4 border border-gray-200 dark:border-gray-700 rounded">
          <div className="flex items-center justify-between mb-3">
            <h4 className="font-medium">API 网关</h4>
            <IndicatorLight color="#22c55e" size={12} />
          </div>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            响应时间: 89ms
            <br />
            正常运行时间: 99.8%
          </p>
        </div>
        <div className="p-4 border border-gray-200 dark:border-gray-700 rounded">
          <div className="flex items-center justify-between mb-3">
            <h4 className="font-medium">缓存服务</h4>
            <IndicatorLight color="#ef4444" size={12} />
          </div>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            响应时间: 超时
            <br />
            正常运行时间: 85.2%
          </p>
        </div>
      </div>
    </div>
  )
}

export const AnimationComparison: Story = {
  render: () => (
    <div className="space-y-6">
      <h3 className="text-lg font-medium">动画效果对比</h3>
      <div className="flex items-center gap-8">
        <div className="text-center">
          <IndicatorLight color="#22c55e" size={16} animation={true} />
          <p className="text-xs mt-2">有动画</p>
        </div>
        <div className="text-center">
          <IndicatorLight color="#22c55e" size={16} animation={false} />
          <p className="text-xs mt-2">无动画</p>
        </div>
      </div>
    </div>
  )
}

export const NotificationDot: Story = {
  render: () => (
    <div className="space-y-6">
      <h3 className="text-lg font-medium">通知红点示例</h3>
      <div className="flex gap-6">
        <div className="relative">
          <div className="w-12 h-12 bg-gray-200 dark:bg-gray-700 rounded-lg flex items-center justify-center">📧</div>
          <div className="absolute -top-1 -end-1">
            <IndicatorLight color="#ef4444" size={8} />
          </div>
        </div>
        <div className="relative">
          <div className="w-12 h-12 bg-gray-200 dark:bg-gray-700 rounded-lg flex items-center justify-center">🔔</div>
          <div className="absolute -top-1 -end-1">
            <IndicatorLight color="#ef4444" size={10} />
          </div>
        </div>
        <div className="relative">
          <div className="w-12 h-12 bg-gray-200 dark:bg-gray-700 rounded-lg flex items-center justify-center">💬</div>
          <div className="absolute -top-1 -end-1">
            <IndicatorLight color="#22c55e" size={8} />
          </div>
        </div>
      </div>
    </div>
  )
}

export const CustomColors: Story = {
  render: () => (
    <div className="space-y-6">
      <h3 className="text-lg font-medium">自定义颜色</h3>
      <div className="grid grid-cols-4 gap-4">
        {[
          '#ff6b6b',
          '#4ecdc4',
          '#45b7d1',
          '#f9ca24',
          '#6c5ce7',
          '#fd79a8',
          '#00b894',
          '#e17055',
          '#74b9ff',
          '#fd79a8',
          '#00cec9',
          '#fdcb6e'
        ].map((color, index) => (
          <div key={index} className="text-center">
            <IndicatorLight color={color} size={14} />
            <p className="text-xs mt-2 font-mono">{color}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
