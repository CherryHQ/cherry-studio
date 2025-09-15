import type { Meta, StoryObj } from '@storybook/react-vite'

import { ErrorTag } from '../../../src/components/base/ErrorTag'

const meta: Meta<typeof ErrorTag> = {
  title: 'Base/ErrorTag',
  component: ErrorTag,
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
    message: '错误信息'
  }
}

export const ServerError: Story = {
  args: {
    message: '服务器连接失败'
  }
}

export const ValidationError: Story = {
  args: {
    message: '数据验证失败',
    iconSize: 16
  }
}

export const Examples: Story = {
  render: () => (
    <div className="space-y-2">
      <ErrorTag message="操作失败" />
      <ErrorTag message="权限不足" />
      <ErrorTag message="文件上传失败" iconSize={18} />
    </div>
  )
}
