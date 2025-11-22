import type { Meta, StoryObj } from '@storybook/react'
import {
  ChevronRight,
  Edit,
  File,
  Folder,
  Heart,
  Mail,
  MoreHorizontal,
  Phone,
  Settings,
  Star,
  Trash2,
  User
} from 'lucide-react'
import { action } from 'storybook/actions'

import { Button, ListItem } from '../../../src/components'

const meta: Meta<typeof ListItem> = {
  title: 'Components/Composites/ListItem',
  component: ListItem,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: '一个通用的列表项组件，支持图标、标题、副标题、激活状态和右侧内容等功能。'
      }
    }
  },
  tags: ['autodocs'],
  argTypes: {
    active: {
      control: { type: 'boolean' },
      description: '是否处于激活状态，激活时会显示高亮样式'
    },
    icon: {
      control: { type: 'text' },
      description: '左侧图标，可以是任何 React 节点'
    },
    title: {
      control: { type: 'text' },
      description: '标题内容，必填字段，可以是文本或 React 节点'
    },
    subtitle: {
      control: { type: 'text' },
      description: '副标题内容，显示在标题下方'
    },
    titleStyle: {
      control: { type: 'object' },
      description: '标题的自定义样式对象'
    },
    onClick: {
      action: 'clicked',
      description: '点击事件处理函数'
    },
    rightContent: {
      control: { type: 'text' },
      description: '右侧内容，可以是任何 React 节点'
    },
    className: {
      control: { type: 'text' },
      description: '自定义 CSS 类名'
    }
  },
  args: {
    title: '列表项标题',
    onClick: action('clicked')
  }
} satisfies Meta<typeof ListItem>

export default meta
type Story = StoryObj<typeof meta>

// 默认样式
export const Default: Story = {
  args: {
    title: '默认列表项'
  },
  render: (args: any) => (
    <div className="w-80">
      <ListItem {...args} />
    </div>
  )
}

// 带图标
export const WithIcon: Story = {
  args: {
    icon: <File size={16} />,
    title: '带图标的列表项',
    subtitle: '这是一个副标题'
  },
  render: (args: any) => (
    <div className="w-80">
      <ListItem {...args} />
    </div>
  )
}

// 激活状态
export const Active: Story = {
  args: {
    icon: <Folder size={16} />,
    title: '激活状态的列表项',
    subtitle: '当前选中项',
    active: true
  },
  render: (args: any) => (
    <div className="w-80">
      <ListItem {...args} />
    </div>
  )
}

// 带右侧内容
export const WithRightContent: Story = {
  args: {
    icon: <Star size={16} />,
    title: '带右侧内容的列表项',
    subtitle: '右侧有附加信息',
    rightContent: <ChevronRight size={16} className="text-gray-400" />
  },
  render: (args: any) => (
    <div className="w-80">
      <ListItem {...args} />
    </div>
  )
}

// 多种图标类型
export const DifferentIcons: Story = {
  render: () => (
    <div className="w-80 space-y-2">
      <ListItem
        icon={<File size={16} className="text-blue-500" />}
        title="文件项"
        subtitle="文档文件"
        onClick={action('file-clicked')}
      />
      <ListItem
        icon={<Folder size={16} className="text-yellow-500" />}
        title="文件夹项"
        subtitle="目录文件夹"
        onClick={action('folder-clicked')}
      />
      <ListItem
        icon={<User size={16} className="text-green-500" />}
        title="用户项"
        subtitle="用户信息"
        onClick={action('user-clicked')}
      />
      <ListItem
        icon={<Settings size={16} className="text-gray-500" />}
        title="设置项"
        subtitle="系统设置"
        onClick={action('settings-clicked')}
      />
    </div>
  )
}

// 不同长度的标题和副标题
export const DifferentContentLength: Story = {
  render: () => (
    <div className="w-80 space-y-2">
      <ListItem icon={<Mail size={16} />} title="短标题" subtitle="短副标题" />
      <ListItem
        icon={<Phone size={16} />}
        title="这是一个比较长的标题，可能会被截断"
        subtitle="这也是一个比较长的副标题，用于测试文本溢出效果"
      />
      <ListItem
        icon={<Heart size={16} />}
        title="超级长的标题内容用于测试文本省略功能，当标题过长时会自动截断并显示省略号"
        subtitle="超级长的副标题内容用于测试文本省略功能，当副标题过长时也会自动截断"
      />
    </div>
  )
}

// 不同的右侧内容类型
export const DifferentRightContent: Story = {
  render: () => (
    <div className="w-80 space-y-2">
      <ListItem
        icon={<File size={16} />}
        title="带箭头"
        subtitle="导航类型"
        rightContent={<ChevronRight size={16} className="text-gray-400" />}
      />
      <ListItem
        icon={<Folder size={16} />}
        title="带按钮"
        subtitle="操作类型"
        rightContent={
          <Button size="icon-sm" variant="ghost">
            <MoreHorizontal size={16} />
          </Button>
        }
      />
      <ListItem
        icon={<User size={16} />}
        title="带文本"
        subtitle="信息显示"
        rightContent={<span className="text-xs text-gray-500">在线</span>}
      />
      <ListItem
        icon={<Settings size={16} />}
        title="带多个操作"
        subtitle="复合操作"
        rightContent={
          <div className="flex gap-1">
            <Button size="icon-sm" variant="ghost">
              <Edit size={14} />
            </Button>
            <Button size="icon-sm" variant="destructive">
              <Trash2 size={14} />
            </Button>
          </div>
        }
      />
    </div>
  )
}

// 激活状态对比
export const ActiveComparison: Story = {
  render: () => (
    <div className="w-80 space-y-2">
      <h3 className="text-sm font-medium mb-2">普通状态</h3>
      <ListItem
        icon={<File size={16} />}
        title="普通列表项"
        subtitle="未激活状态"
        rightContent={<ChevronRight size={16} className="text-gray-400" />}
      />

      <h3 className="text-sm font-medium mb-2 mt-4">激活状态</h3>
      <ListItem
        icon={<File size={16} />}
        title="激活列表项"
        subtitle="当前选中状态"
        active={true}
        rightContent={<ChevronRight size={16} className="text-gray-400" />}
      />
    </div>
  )
}

// 自定义标题样式
export const CustomTitleStyle: Story = {
  render: () => (
    <div className="w-80 space-y-2">
      <ListItem
        icon={<Star size={16} />}
        title="红色标题"
        subtitle="自定义颜色"
        titleStyle={{ color: '#ef4444', fontWeight: 'bold' }}
      />
      <ListItem
        icon={<Heart size={16} />}
        title="大号标题"
        subtitle="自定义大小"
        titleStyle={{ fontSize: '16px', fontWeight: '600' }}
      />
      <ListItem
        icon={<User size={16} />}
        title="斜体标题"
        subtitle="自定义样式"
        titleStyle={{ fontStyle: 'italic', color: '#6366f1' }}
      />
    </div>
  )
}

// 无副标题
export const WithoutSubtitle: Story = {
  render: () => (
    <div className="w-80 space-y-2">
      <ListItem icon={<File size={16} />} title="只有标题的列表项" />
      <ListItem
        icon={<Folder size={16} />}
        title="另一个只有标题的项"
        rightContent={<ChevronRight size={16} className="text-gray-400" />}
      />
    </div>
  )
}

// 无图标
export const WithoutIcon: Story = {
  render: () => (
    <div className="w-80 space-y-2">
      <ListItem title="无图标列表项" subtitle="没有左侧图标" />
      <ListItem
        title="另一个无图标项"
        subtitle="简洁样式"
        rightContent={<span className="text-xs text-gray-500">标签</span>}
      />
    </div>
  )
}

// 完整功能展示
export const FullFeatures: Story = {
  render: () => (
    <div className="w-80 space-y-2">
      <ListItem
        icon={<File size={16} className="text-blue-500" />}
        title="完整功能展示"
        subtitle="包含所有功能的列表项"
        titleStyle={{ fontWeight: '600' }}
        active={true}
        rightContent={
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">NEW</span>
            <ChevronRight size={16} className="text-gray-400" />
          </div>
        }
        onClick={action('full-features-clicked')}
        className="hover:shadow-sm transition-shadow"
      />
    </div>
  )
}
