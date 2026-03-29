import type { Meta, StoryObj } from '@storybook/react'

import { Divider } from '../../../src/components'

const meta: Meta<typeof Divider> = {
  title: 'Components/Primitives/Divider',
  component: Divider,
  parameters: {
    layout: 'padded'
  },
  tags: ['autodocs'],
  argTypes: {
    orientation: {
      control: 'select',
      options: ['horizontal', 'vertical'],
      description: '分割线方向'
    },
    className: {
      control: 'text',
      description: '自定义类名'
    }
  }
}

export default meta
type Story = StoryObj<typeof meta>

export const Horizontal: Story = {
  args: {
    orientation: 'horizontal'
  },
  render: (args) => (
    <div className="w-full">
      <p className="mb-2">上方内容</p>
      <Divider {...args} />
      <p className="mt-2">下方内容</p>
    </div>
  )
}

export const Vertical: Story = {
  args: {
    orientation: 'vertical'
  },
  render: (args) => (
    <div className="flex h-8 items-center">
      <span>左侧</span>
      <Divider {...args} />
      <span>右侧</span>
    </div>
  )
}

export const InSettingsContext: Story = {
  render: () => (
    <div className="space-y-4 max-w-md">
      <h3 className="text-lg font-medium">设置示例</h3>

      <div className="flex justify-between items-center">
        <span className="text-sm">语言设置</span>
        <span className="text-sm text-gray-500">中文</span>
      </div>

      <Divider />

      <div className="flex justify-between items-center">
        <span className="text-sm">主题设置</span>
        <span className="text-sm text-gray-500">深色</span>
      </div>

      <Divider />

      <div className="flex justify-between items-center">
        <span className="text-sm">通知设置</span>
        <span className="text-sm text-gray-500">开启</span>
      </div>
    </div>
  )
}

export const MultipleHorizontal: Story = {
  render: () => (
    <div className="space-y-2 max-w-md">
      <p>第一段内容</p>
      <Divider />
      <p>第二段内容</p>
      <Divider />
      <p>第三段内容</p>
      <Divider />
      <p>第四段内容</p>
    </div>
  )
}

export const VerticalInNavigation: Story = {
  render: () => (
    <div className="flex h-6 items-center gap-0">
      <a href="#" className="text-sm text-blue-600 hover:underline">
        首页
      </a>
      <Divider orientation="vertical" />
      <a href="#" className="text-sm text-blue-600 hover:underline">
        设置
      </a>
      <Divider orientation="vertical" />
      <a href="#" className="text-sm text-blue-600 hover:underline">
        帮助
      </a>
      <Divider orientation="vertical" />
      <a href="#" className="text-sm text-blue-600 hover:underline">
        关于
      </a>
    </div>
  )
}

export const CustomStyle: Story = {
  render: () => (
    <div className="space-y-6 max-w-md">
      <div>
        <p className="text-sm text-gray-500 mb-2">默认分割线</p>
        <Divider />
      </div>

      <div>
        <p className="text-sm text-gray-500 mb-2">加粗分割线</p>
        <Divider className="border-t-2" />
      </div>

      <div>
        <p className="text-sm text-gray-500 mb-2">彩色分割线</p>
        <Divider className="border-t-blue-500" />
      </div>

      <div>
        <p className="text-sm text-gray-500 mb-2">虚线分割线</p>
        <Divider className="border-dashed" />
      </div>

      <div>
        <p className="text-sm text-gray-500 mb-2">增加间距的分割线</p>
        <Divider className="my-6" />
      </div>
    </div>
  )
}

export const BothOrientations: Story = {
  render: () => (
    <div className="space-y-8">
      <div>
        <h4 className="text-sm font-medium mb-4">水平分割线 (Horizontal)</h4>
        <div className="p-4 border rounded">
          <p>上方内容区域</p>
          <Divider orientation="horizontal" />
          <p>下方内容区域</p>
        </div>
      </div>

      <div>
        <h4 className="text-sm font-medium mb-4">垂直分割线 (Vertical)</h4>
        <div className="p-4 border rounded flex items-center h-12">
          <span>左侧内容</span>
          <Divider orientation="vertical" />
          <span>右侧内容</span>
        </div>
      </div>
    </div>
  )
}
