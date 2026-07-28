import type { Meta, StoryObj } from '@storybook/react-vite'
import { AlertTriangleIcon, StarIcon } from 'lucide-react'
import { action } from 'storybook/actions'

import { CustomTag } from '../../../src/components'

const meta: Meta<typeof CustomTag> = {
  title: 'Components/Primitives/CustomTag',
  component: CustomTag,
  parameters: {
    layout: 'centered'
  },
  tags: ['autodocs'],
  argTypes: {
    color: { control: 'color' },
    size: { control: { type: 'range', min: 8, max: 24, step: 1 } },
    disabled: { control: 'boolean' },
    inactive: { control: 'boolean' },
    closable: { control: 'boolean' },
    onClose: { action: 'closed' },
    onClick: { action: 'clicked' }
  }
}

export default meta
type Story = StoryObj<typeof meta>

// 基础示例
export const Default: Story = {
  args: {
    children: '默认标签',
    color: '#1890ff'
  }
}

// 带图标
export const WithIcon: Story = {
  args: {
    children: '带图标',
    color: '#52c41a',
    icon: <StarIcon size={12} />
  }
}

// 可关闭
export const Closable: Story = {
  args: {
    children: '可关闭标签',
    color: '#fa8c16',
    closable: true,
    onClose: action('tag-closed')
  }
}

// 不同尺寸
export const Sizes: Story = {
  render: () => (
    <div className="flex items-center gap-4">
      <CustomTag color="#1890ff" size={10}>
        小号
      </CustomTag>
      <CustomTag color="#1890ff" size={14}>
        中号
      </CustomTag>
      <CustomTag color="#1890ff" size={18}>
        大号
      </CustomTag>
    </div>
  )
}

// 不同状态
export const States: Story = {
  render: () => (
    <div className="flex flex-col gap-4">
      <div className="flex gap-2">
        <CustomTag color="#52c41a">正常</CustomTag>
        <CustomTag color="#52c41a" disabled>
          禁用
        </CustomTag>
        <CustomTag color="#52c41a" inactive>
          未激活
        </CustomTag>
      </div>
      <div className="flex gap-2">
        <CustomTag color="#1890ff" onClick={action('clicked')}>
          可点击
        </CustomTag>
        <CustomTag color="#fa541c" tooltip="这是一个提示">
          带提示
        </CustomTag>
      </div>
    </div>
  )
}

// 实际使用场景
export const UseCases: Story = {
  render: () => (
    <div className="space-y-4">
      <div>
        <h4 className="mb-2">技能标签:</h4>
        <div className="flex flex-wrap gap-2">
          <CustomTag color="#1890ff">React</CustomTag>
          <CustomTag color="#52c41a">TypeScript</CustomTag>
          <CustomTag color="#fa8c16">Tailwind</CustomTag>
        </div>
      </div>

      <div>
        <h4 className="mb-2">状态标签:</h4>
        <div className="flex gap-2">
          <CustomTag color="#52c41a" icon={<AlertTriangleIcon size={12} />}>
            进行中
          </CustomTag>
          <CustomTag color="#fa541c" closable onClose={action('task-removed')}>
            待处理
          </CustomTag>
        </div>
      </div>
    </div>
  )
}
