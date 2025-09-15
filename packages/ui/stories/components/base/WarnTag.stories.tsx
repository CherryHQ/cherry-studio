import type { Meta, StoryObj } from '@storybook/react-vite'

import { WarnTag } from '../../../src/components/base/WarnTag'

const meta: Meta<typeof WarnTag> = {
  title: 'Base/WarnTag',
  component: WarnTag,
  parameters: {
    layout: 'centered'
  },
  tags: ['autodocs'],
  argTypes: {
    iconSize: { control: { type: 'range', min: 10, max: 20, step: 1 } },
    message: { control: 'text' }
  }
}

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: {
    message: '警告信息'
  }
}

export const LongMessage: Story = {
  args: {
    message: '这是一个比较长的警告信息'
  }
}

export const CustomIconSize: Story = {
  args: {
    message: '自定义图标大小',
    iconSize: 18
  }
}

export const Examples: Story = {
  render: () => (
    <div className="space-y-2">
      <WarnTag message="表单验证失败" />
      <WarnTag message="网络连接不稳定" />
      <WarnTag message="存储空间不足" iconSize={16} />
    </div>
  )
}
