import type { Meta, StoryObj } from '@storybook/react'

import { Ellipsis } from '../../../src/components'

const meta = {
  title: 'Components/Composites/Ellipsis',
  component: Ellipsis,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: '一个用于显示省略文本的组件，支持单行和多行省略功能。'
      }
    }
  },
  tags: ['autodocs'],
  argTypes: {
    maxLine: {
      control: { type: 'number' },
      description: '最大显示行数，默认为1。设置为1时为单行省略，大于1时为多行省略。'
    },
    className: {
      control: { type: 'text' },
      description: '自定义 CSS 类名'
    },
    children: {
      control: { type: 'text' },
      description: '要显示的文本内容'
    }
  },
  args: {
    children: '这是一段很长的文本内容，用于演示省略功能的效果。当文本超出容器宽度或高度时，会自动显示省略号。'
  }
} satisfies Meta<typeof Ellipsis>

export default meta
type Story = StoryObj<typeof meta>

// 默认单行省略
export const Default: Story = {
  args: {
    maxLine: 1
  },
  render: (args) => (
    <div className="w-60 p-4 border border-gray-200 dark:border-gray-700 rounded">
      <Ellipsis {...args} />
    </div>
  )
}

// 多行省略
export const MultiLine: Story = {
  args: {
    maxLine: 3,
    children:
      '这是一段很长的文本内容，用于演示多行省略功能的效果。当文本内容超过指定的最大行数时，会在最后一行的末尾显示省略号。这个功能特别适用于显示文章摘要、商品描述等需要限制显示行数的场景。'
  },
  render: (args) => (
    <div className="w-80 p-4 border border-gray-200 dark:border-gray-700 rounded">
      <Ellipsis {...args} />
    </div>
  )
}

// 不同的最大行数
export const DifferentMaxLines: Story = {
  render: () => (
    <div className="space-y-4 max-w-lg">
      <div>
        <h3 className="text-sm font-medium mb-2">单行省略 (maxLine = 1)</h3>
        <div className="p-3 border border-gray-200 dark:border-gray-700 rounded">
          <Ellipsis maxLine={1}>这是一段很长的文本内容，用于演示单行省略功能的效果。</Ellipsis>
        </div>
      </div>

      <div>
        <h3 className="text-sm font-medium mb-2">两行省略 (maxLine = 2)</h3>
        <div className="p-3 border border-gray-200 dark:border-gray-700 rounded">
          <Ellipsis maxLine={2}>
            这是一段很长的文本内容，用于演示两行省略功能的效果。当文本内容超过两行时，会在第二行的末尾显示省略号。
          </Ellipsis>
        </div>
      </div>

      <div>
        <h3 className="text-sm font-medium mb-2">三行省略 (maxLine = 3)</h3>
        <div className="p-3 border border-gray-200 dark:border-gray-700 rounded">
          <Ellipsis maxLine={3}>
            这是一段很长的文本内容，用于演示三行省略功能的效果。当文本内容超过三行时，会在第三行的末尾显示省略号。这个功能特别适用于显示文章摘要、商品描述等需要限制显示行数的场景。
          </Ellipsis>
        </div>
      </div>
    </div>
  )
}

// 短文本（不需要省略）
export const ShortText: Story = {
  args: {
    maxLine: 2,
    children: '这是一段短文本。'
  },
  render: (args) => (
    <div className="w-80 p-4 border border-gray-200 dark:border-gray-700 rounded">
      <Ellipsis {...args} />
    </div>
  )
}

// 自定义样式
export const CustomStyle: Story = {
  args: {
    maxLine: 2,
    className: 'text-blue-600 font-medium text-lg',
    children: '这是一段带有自定义样式的长文本内容，用于演示如何自定义省略文本的样式。'
  },
  render: (args) => (
    <div className="w-80 p-4 border border-gray-200 dark:border-gray-700 rounded">
      <Ellipsis {...args} />
    </div>
  )
}

// 不同容器宽度的响应式展示
export const ResponsiveWidth: Story = {
  render: () => (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-medium mb-2">窄容器 (200px)</h3>
        <div className="w-50 p-3 border border-gray-200 dark:border-gray-700 rounded">
          <Ellipsis maxLine={2}>这是一段在窄容器中显示的文本内容，用于演示在不同宽度下的省略效果。</Ellipsis>
        </div>
      </div>

      <div>
        <h3 className="text-sm font-medium mb-2">中等容器 (300px)</h3>
        <div className="w-75 p-3 border border-gray-200 dark:border-gray-700 rounded">
          <Ellipsis maxLine={2}>这是一段在中等宽度容器中显示的文本内容，用于演示在不同宽度下的省略效果。</Ellipsis>
        </div>
      </div>

      <div>
        <h3 className="text-sm font-medium mb-2">宽容器 (400px)</h3>
        <div className="w-100 p-3 border border-gray-200 dark:border-gray-700 rounded">
          <Ellipsis maxLine={2}>这是一段在宽容器中显示的文本内容，用于演示在不同宽度下的省略效果。</Ellipsis>
        </div>
      </div>
    </div>
  )
}

// 包含HTML内容
export const WithHTMLContent: Story = {
  args: {
    maxLine: 2
  },
  render: (args) => (
    <div className="w-80 p-4 border border-gray-200 dark:border-gray-700 rounded">
      <Ellipsis {...args}>
        <span className="text-red-500">这是红色文本</span>和<strong className="font-bold">加粗文本</strong>
        以及
        <em className="italic">斜体文本</em>
        组合的长文本内容，用于演示包含HTML元素的省略效果。
      </Ellipsis>
    </div>
  )
}
