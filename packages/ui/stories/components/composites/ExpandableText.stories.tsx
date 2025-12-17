import type { Meta, StoryObj } from '@storybook/react'

import { ExpandableText } from '../../../src/components'

const meta: Meta<typeof ExpandableText> = {
  title: 'Components/Composites/ExpandableText',
  component: ExpandableText,
  parameters: {
    layout: 'centered'
  },
  tags: ['autodocs'],
  argTypes: {
    text: {
      control: 'text',
      description: '要显示的文本内容'
    },
    expandText: {
      control: 'text',
      description: '展开按钮文本',
      defaultValue: 'Expand'
    },
    collapseText: {
      control: 'text',
      description: '收起按钮文本',
      defaultValue: 'Collapse'
    },
    lineClamp: {
      control: { type: 'range', min: 1, max: 5, step: 1 },
      description: '收起时显示的行数',
      defaultValue: 1
    },
    className: {
      control: 'text',
      description: '自定义类名'
    }
  }
} satisfies Meta<typeof ExpandableText>

export default meta
type Story = StoryObj<typeof meta>

const longText =
  'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.'

const chineseText =
  '这是一段很长的中文文本内容，用于测试文本展开和收起功能。当文本内容超过指定的行数限制时，会显示省略号，用户可以点击展开按钮查看完整内容，也可以点击收起按钮将文本重新收起。这个组件在显示长文本内容时非常有用。'

// 基础用法
export const Default: Story = {
  args: {
    text: longText,
    expandText: 'Expand',
    collapseText: 'Collapse'
  }
}

// 单行省略
export const SingleLine: Story = {
  args: {
    text: longText,
    lineClamp: 1
  }
}

// 多行省略
export const MultiLine: Story = {
  render: (args) => (
    <div className="flex flex-col gap-4 w-96">
      <div>
        <h3 className="text-sm font-semibold mb-2">显示 2 行</h3>
        <ExpandableText {...args} text={longText} lineClamp={2} />
      </div>
      <div>
        <h3 className="text-sm font-semibold mb-2">显示 3 行</h3>
        <ExpandableText {...args} text={longText} lineClamp={3} />
      </div>
      <div>
        <h3 className="text-sm font-semibold mb-2">显示 4 行</h3>
        <ExpandableText {...args} text={longText} lineClamp={4} />
      </div>
    </div>
  )
}

// 中文文本
export const ChineseText: Story = {
  args: {
    text: chineseText,
    expandText: '展开',
    collapseText: '收起',
    lineClamp: 2
  }
}

// 短文本（不需要展开）
export const ShortText: Story = {
  args: {
    text: 'This is a short text.',
    lineClamp: 1
  }
}

// 自定义按钮文本
export const CustomButtonText: Story = {
  args: {
    text: longText,
    expandText: 'Show More',
    collapseText: 'Show Less',
    lineClamp: 2
  }
}

// 不同语言示例
export const Multilingual: Story = {
  render: (args) => (
    <div className="flex flex-col gap-6 w-96">
      <div>
        <h3 className="text-sm font-semibold mb-2">English</h3>
        <ExpandableText
          {...args}
          text="This is a long English text that demonstrates the expand and collapse functionality. It contains multiple sentences to show how the component handles longer content."
          expandText="Read more"
          collapseText="Read less"
          lineClamp={2}
        />
      </div>
      <div>
        <h3 className="text-sm font-semibold mb-2">中文</h3>
        <ExpandableText
          {...args}
          text="这是一段较长的中文示例文本，用于展示组件的展开和收起功能。它包含多个句子，以显示组件如何处理较长的内容。"
          expandText="查看更多"
          collapseText="收起"
          lineClamp={2}
        />
      </div>
      <div>
        <h3 className="text-sm font-semibold mb-2">日本語</h3>
        <ExpandableText
          {...args}
          text="これは、展開と折りたたみ機能を示す長い日本語のテキストです。コンポーネントが長いコンテンツをどのように処理するかを示すために、複数の文が含まれています。"
          expandText="もっと見る"
          collapseText="閉じる"
          lineClamp={2}
        />
      </div>
    </div>
  )
}

// 在卡片中使用
export const InCard: Story = {
  render: (args) => (
    <div className="bg-white rounded-lg shadow-md p-6 max-w-md">
      <h2 className="text-xl font-bold mb-2">Article Title</h2>
      <p className="text-sm text-gray-500 mb-4">Published on December 1, 2024</p>
      <ExpandableText
        {...args}
        text="This is a preview of the article content. Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris."
        lineClamp={3}
      />
    </div>
  )
}

// 列表项中使用
export const InList: Story = {
  render: (args) => (
    <div className="space-y-4 max-w-lg">
      {[
        {
          title: 'First Item',
          text: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore.'
        },
        {
          title: 'Second Item',
          text: 'Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.'
        },
        {
          title: 'Third Item',
          text: 'Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur.'
        }
      ].map((item, index) => (
        <div key={index} className="border rounded-lg p-4">
          <h3 className="font-semibold mb-2">{item.title}</h3>
          <ExpandableText {...args} text={item.text} lineClamp={2} />
        </div>
      ))}
    </div>
  )
}

// 自定义样式
export const CustomStyle: Story = {
  args: {
    text: longText,
    lineClamp: 2,
    className: 'bg-blue-50 p-4 rounded-lg',
    style: { fontStyle: 'italic' }
  }
}
