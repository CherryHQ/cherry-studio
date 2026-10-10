import type { Meta, StoryObj } from '@storybook/react'

import { EmojiAvatar } from '../../../src/components'

const meta: Meta<typeof EmojiAvatar> = {
  title: 'Components/Primitives/emoji-avatar',
  component: EmojiAvatar,
  parameters: {
    layout: 'centered'
  },
  tags: ['autodocs'],
  argTypes: {
    children: {
      control: 'text',
      description: 'Emoji 字符',
      defaultValue: '😊'
    },
    size: {
      control: { type: 'range', min: 20, max: 100, step: 1 },
      description: '头像尺寸',
      defaultValue: 31
    },
    fontSize: {
      control: { type: 'range', min: 10, max: 50, step: 1 },
      description: '字体大小（默认为 size * 0.5）'
    },
    className: {
      control: 'text',
      description: '自定义类名'
    }
  }
} satisfies Meta<typeof EmojiAvatar>

export default meta
type Story = StoryObj<typeof meta>

// 基础用法
export const Default: Story = {
  args: {
    children: '😊',
    size: 40
  }
}

// 不同尺寸展示
export const Sizes: Story = {
  render: (args) => (
    <div className="flex items-center gap-4">
      <EmojiAvatar {...args} children="😊" size={24} />
      <EmojiAvatar {...args} children="🎉" size={32} />
      <EmojiAvatar {...args} children="🚀" size={40} />
      <EmojiAvatar {...args} children="❤️" size={48} />
      <EmojiAvatar {...args} children="🌟" size={56} />
      <EmojiAvatar {...args} children="🎨" size={64} />
    </div>
  )
}

// 各种 Emoji
export const VariousEmojis: Story = {
  render: (args) => (
    <div className="grid grid-cols-6 gap-4">
      {[
        '😀',
        '😎',
        '🥳',
        '🤔',
        '😴',
        '🤯',
        '❤️',
        '🔥',
        '✨',
        '🎉',
        '🎯',
        '🚀',
        '🌟',
        '🌈',
        '☀️',
        '🌸',
        '🍕',
        '🎨',
        '📚',
        '💡',
        '🔧',
        '🎮',
        '🎵',
        '🏆'
      ].map((emoji) => (
        <EmojiAvatar key={emoji} {...args} children={emoji} size={40} />
      ))}
    </div>
  )
}

// 自定义字体大小
export const CustomFontSize: Story = {
  render: (args) => (
    <div className="flex items-center gap-4">
      <div className="text-center">
        <EmojiAvatar {...args} children="🎯" size={50} fontSize={15} />
        <p className="mt-2 text-xs text-gray-500">字体: 15px</p>
      </div>
      <div className="text-center">
        <EmojiAvatar {...args} children="🎯" size={50} fontSize={25} />
        <p className="mt-2 text-xs text-gray-500">字体: 25px (默认)</p>
      </div>
      <div className="text-center">
        <EmojiAvatar {...args} children="🎯" size={50} fontSize={35} />
        <p className="mt-2 text-xs text-gray-500">字体: 35px</p>
      </div>
    </div>
  )
}

// 点击交互
export const Interactive: Story = {
  args: {
    children: '👆',
    size: 50,
    onClick: () => alert('Emoji clicked!')
  }
}

// 自定义样式
export const CustomStyles: Story = {
  render: (args) => (
    <div className="flex items-center gap-4">
      <EmojiAvatar {...args} children="🎨" size={50} style={{ backgroundColor: '#ffe4e1' }} />
      <EmojiAvatar {...args} children="🌊" size={50} style={{ backgroundColor: '#e0f2ff' }} />
      <EmojiAvatar {...args} children="🌿" size={50} style={{ backgroundColor: '#e8f5e9' }} />
      <EmojiAvatar {...args} children="☀️" size={50} style={{ backgroundColor: '#fff8e1' }} />
    </div>
  )
}

// 组合使用
export const WithLabels: Story = {
  render: (args) => (
    <div className="flex items-center gap-6">
      {[
        { emoji: '😊', label: 'Happy' },
        { emoji: '😢', label: 'Sad' },
        { emoji: '😡', label: 'Angry' },
        { emoji: '😴', label: 'Tired' }
      ].map(({ emoji, label }) => (
        <div key={label} className="flex flex-col items-center gap-2">
          <EmojiAvatar {...args} children={emoji} size={48} />
          <span className="text-sm text-gray-600">{label}</span>
        </div>
      ))}
    </div>
  )
}

// 网格展示
export const Grid: Story = {
  render: (args) => (
    <div className="w-96">
      <h3 className="mb-4 text-lg font-semibold">选择你的心情</h3>
      <div className="grid grid-cols-8 gap-2">
        {[
          '😊',
          '😂',
          '😍',
          '🤔',
          '😎',
          '😴',
          '😭',
          '😡',
          '🤗',
          '😏',
          '😅',
          '😌',
          '🙄',
          '😮',
          '😐',
          '😯',
          '😪',
          '😫',
          '🥱',
          '😤',
          '😢',
          '😥',
          '😰',
          '🤯'
        ].map((emoji) => (
          <EmojiAvatar
            key={emoji}
            {...args}
            children={emoji}
            size={36}
            onClick={() => console.log(`Selected: ${emoji}`)}
          />
        ))}
      </div>
    </div>
  )
}
