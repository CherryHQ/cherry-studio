import type { Meta, StoryObj } from '@storybook/react'

import EmojiIcon from '../../../src/components/base/EmojiIcon'

const meta: Meta<typeof EmojiIcon> = {
  title: 'Base/EmojiIcon',
  component: EmojiIcon,
  parameters: {
    layout: 'centered'
  },
  tags: ['autodocs'],
  argTypes: {
    emoji: {
      control: 'text',
      description: '要显示的 emoji 字符'
    },
    className: {
      control: 'text',
      description: '自定义 CSS 类名'
    },
    size: {
      control: { type: 'range', min: 16, max: 80, step: 2 },
      description: '图标容器的大小（像素）'
    },
    fontSize: {
      control: { type: 'range', min: 8, max: 40, step: 1 },
      description: 'emoji 的字体大小（像素）'
    }
  }
}

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: {}
}

export const Star: Story = {
  args: {
    emoji: '⭐️'
  }
}

export const Heart: Story = {
  args: {
    emoji: '❤️'
  }
}

export const Smile: Story = {
  args: {
    emoji: '😊'
  }
}

export const Fire: Story = {
  args: {
    emoji: '🔥'
  }
}

export const Rocket: Story = {
  args: {
    emoji: '🚀'
  }
}

export const SmallSize: Story = {
  args: {
    emoji: '🎯',
    size: 20,
    fontSize: 12
  }
}

export const LargeSize: Story = {
  args: {
    emoji: '🌟',
    size: 60,
    fontSize: 30
  }
}

export const CustomStyle: Story = {
  args: {
    emoji: '💎',
    size: 40,
    fontSize: 20,
    className: 'border-2 border-blue-300 dark:border-blue-600 shadow-lg'
  }
}

export const EmojiCollection: Story = {
  render: () => (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium mb-4">表情符号集合</h3>
        <div className="grid grid-cols-6 gap-4">
          {[
            '😀',
            '😃',
            '😄',
            '😁',
            '😊',
            '😍',
            '🤔',
            '😎',
            '🤗',
            '😴',
            '🙄',
            '😇',
            '❤️',
            '💙',
            '💚',
            '💛',
            '🧡',
            '💜',
            '⭐',
            '🌟',
            '✨',
            '🔥',
            '💎',
            '🎯',
            '🚀',
            '⚡',
            '🌈',
            '🎉',
            '🎊',
            '🏆'
          ].map((emoji, index) => (
            <EmojiIcon key={index} emoji={emoji} size={32} fontSize={16} />
          ))}
        </div>
      </div>
    </div>
  )
}

export const SizeComparison: Story = {
  render: () => (
    <div className="space-y-6">
      <h3 className="text-lg font-medium mb-4">不同尺寸对比</h3>
      <div className="flex items-center gap-6">
        <div className="text-center">
          <EmojiIcon emoji="🎨" size={20} fontSize={12} />
          <p className="text-xs mt-2">小 (20px)</p>
        </div>
        <div className="text-center">
          <EmojiIcon emoji="🎨" size={30} fontSize={16} />
          <p className="text-xs mt-2">中 (30px)</p>
        </div>
        <div className="text-center">
          <EmojiIcon emoji="🎨" size={40} fontSize={20} />
          <p className="text-xs mt-2">大 (40px)</p>
        </div>
        <div className="text-center">
          <EmojiIcon emoji="🎨" size={60} fontSize={30} />
          <p className="text-xs mt-2">特大 (60px)</p>
        </div>
      </div>
    </div>
  )
}

export const InUserInterface: Story = {
  render: () => (
    <div className="space-y-6">
      <h3 className="text-lg font-medium mb-4">界面应用示例</h3>

      {/* 用户头像 */}
      <div className="space-y-3">
        <h4 className="font-medium">用户头像</h4>
        <div className="flex items-center gap-3">
          <EmojiIcon emoji="👤" size={40} fontSize={20} />
          <div>
            <p className="font-medium">用户名</p>
            <p className="text-sm text-gray-500">user@example.com</p>
          </div>
        </div>
      </div>

      {/* 状态指示器 */}
      <div className="space-y-3">
        <h4 className="font-medium">状态指示器</h4>
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <EmojiIcon emoji="✅" size={24} fontSize={14} />
            <span>任务已完成</span>
          </div>
          <div className="flex items-center gap-2">
            <EmojiIcon emoji="⏳" size={24} fontSize={14} />
            <span>进行中</span>
          </div>
          <div className="flex items-center gap-2">
            <EmojiIcon emoji="❌" size={24} fontSize={14} />
            <span>任务失败</span>
          </div>
        </div>
      </div>

      {/* 导航菜单 */}
      <div className="space-y-3">
        <h4 className="font-medium">导航菜单</h4>
        <div className="space-y-1">
          <div className="flex items-center gap-3 p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded cursor-pointer">
            <EmojiIcon emoji="🏠" size={24} fontSize={14} />
            <span>首页</span>
          </div>
          <div className="flex items-center gap-3 p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded cursor-pointer">
            <EmojiIcon emoji="📊" size={24} fontSize={14} />
            <span>数据统计</span>
          </div>
          <div className="flex items-center gap-3 p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded cursor-pointer">
            <EmojiIcon emoji="⚙️" size={24} fontSize={14} />
            <span>设置</span>
          </div>
        </div>
      </div>
    </div>
  )
}

export const CategoryIcons: Story = {
  render: () => (
    <div className="space-y-6">
      <h3 className="text-lg font-medium mb-4">分类图标</h3>

      <div className="grid grid-cols-2 gap-6">
        <div>
          <h4 className="font-medium mb-3">工作相关</h4>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <EmojiIcon emoji="💼" size={24} fontSize={14} />
              <span>商务</span>
            </div>
            <div className="flex items-center gap-2">
              <EmojiIcon emoji="📈" size={24} fontSize={14} />
              <span>分析</span>
            </div>
            <div className="flex items-center gap-2">
              <EmojiIcon emoji="💻" size={24} fontSize={14} />
              <span>开发</span>
            </div>
          </div>
        </div>

        <div>
          <h4 className="font-medium mb-3">生活相关</h4>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <EmojiIcon emoji="🍕" size={24} fontSize={14} />
              <span>美食</span>
            </div>
            <div className="flex items-center gap-2">
              <EmojiIcon emoji="✈️" size={24} fontSize={14} />
              <span>旅行</span>
            </div>
            <div className="flex items-center gap-2">
              <EmojiIcon emoji="🎵" size={24} fontSize={14} />
              <span>音乐</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export const AnimatedExample: Story = {
  render: () => (
    <div className="space-y-6">
      <h3 className="text-lg font-medium mb-4">交互示例</h3>
      <div className="flex gap-4">
        {['🎉', '🎊', '✨', '🌟', '⭐'].map((emoji, index) => (
          <div
            key={index}
            className="cursor-pointer transition-transform duration-200 hover:scale-110"
            onClick={() => alert(`点击了 ${emoji}`)}>
            <EmojiIcon emoji={emoji} size={36} fontSize={18} />
          </div>
        ))}
      </div>
      <p className="text-sm text-gray-500">点击上面的图标试试</p>
    </div>
  )
}

export const BlurEffect: Story = {
  render: () => (
    <div className="space-y-6">
      <h3 className="text-lg font-medium mb-4">模糊效果展示</h3>
      <p className="text-sm text-gray-600 mb-4">EmojiIcon 组件具有独特的模糊背景效果，让 emoji 看起来更有层次感</p>
      <div className="flex gap-6">
        <div className="text-center">
          <EmojiIcon emoji="🌙" size={50} fontSize={25} />
          <p className="text-xs mt-2">夜晚模式</p>
        </div>
        <div className="text-center">
          <EmojiIcon emoji="☀️" size={50} fontSize={25} />
          <p className="text-xs mt-2">白天模式</p>
        </div>
        <div className="text-center">
          <EmojiIcon emoji="🌈" size={50} fontSize={25} />
          <p className="text-xs mt-2">彩虹效果</p>
        </div>
      </div>
    </div>
  )
}
