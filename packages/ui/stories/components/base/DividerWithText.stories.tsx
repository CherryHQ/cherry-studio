import type { Meta, StoryObj } from '@storybook/react'

import DividerWithText from '../../../src/components/base/DividerWithText'

const meta: Meta<typeof DividerWithText> = {
  title: 'Base/DividerWithText',
  component: DividerWithText,
  parameters: {
    layout: 'padded'
  },
  tags: ['autodocs'],
  argTypes: {
    text: {
      control: 'text',
      description: '分割线上显示的文字'
    },
    style: {
      control: false,
      description: '自定义样式对象'
    }
  }
}

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: {
    text: '分割线'
  }
}

export const ShortText: Story = {
  args: {
    text: '或'
  }
}

export const LongText: Story = {
  args: {
    text: '这是一个较长的分割线文字'
  }
}

export const EnglishText: Story = {
  args: {
    text: 'OR'
  }
}

export const WithNumbers: Story = {
  args: {
    text: '步骤 1'
  }
}

export const WithSymbols: Story = {
  args: {
    text: '• • •'
  }
}

export const CustomStyle: Story = {
  args: {
    text: '自定义样式',
    style: {
      marginTop: '16px',
      marginBottom: '16px'
    }
  }
}

export const MultipleUsage: Story = {
  render: () => (
    <div className="space-y-8">
      <div>
        <h3 className="text-lg font-medium mb-4">登录表单示例</h3>
        <div className="max-w-md mx-auto space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">邮箱</label>
            <input
              type="email"
              className="w-full px-3 py-2 border border-gray-300 rounded-md"
              placeholder="请输入邮箱"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">密码</label>
            <input
              type="password"
              className="w-full px-3 py-2 border border-gray-300 rounded-md"
              placeholder="请输入密码"
            />
          </div>
          <button type="button" className="w-full bg-blue-600 text-white py-2 rounded-md hover:bg-blue-700">
            登录
          </button>

          <DividerWithText text="或" />

          <button type="button" className="w-full border border-gray-300 py-2 rounded-md hover:bg-gray-50">
            使用 Google 登录
          </button>
          <button type="button" className="w-full border border-gray-300 py-2 rounded-md hover:bg-gray-50">
            使用 GitHub 登录
          </button>
        </div>
      </div>
    </div>
  )
}

export const InSections: Story = {
  render: () => (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold mb-4">文章内容</h2>
        <p className="text-gray-600 mb-4">这是文章的第一段内容。在这里我们可以看到一些基本信息和介绍性的内容。</p>

        <DividerWithText text="正文开始" />

        <p className="text-gray-600 mb-4">文章的正文部分开始了。这里包含了详细的内容和分析。</p>
        <p className="text-gray-600 mb-4">更多的内容段落，提供深入的见解和分析。</p>

        <DividerWithText text="总结" />

        <p className="text-gray-600">最后是总结部分，概括了文章的主要观点和结论。</p>
      </div>
    </div>
  )
}

export const WithSteps: Story = {
  render: () => (
    <div className="space-y-6">
      <h3 className="text-lg font-medium">安装步骤</h3>

      <div className="space-y-1">
        <p className="text-sm">下载安装包到本地</p>
      </div>

      <DividerWithText text="步骤 1 完成" />

      <div className="space-y-1">
        <p className="text-sm">解压缩文件到指定目录</p>
      </div>

      <DividerWithText text="步骤 2 完成" />

      <div className="space-y-1">
        <p className="text-sm">运行安装程序</p>
      </div>

      <DividerWithText text="步骤 3 完成" />

      <div className="space-y-1">
        <p className="text-sm font-medium text-green-600">安装完成！</p>
      </div>
    </div>
  )
}

export const DifferentSizes: Story = {
  render: () => (
    <div className="space-y-6">
      <h3 className="text-lg font-medium">不同样式的分割线</h3>

      <div className="space-y-4">
        <DividerWithText text="默认样式" />

        <DividerWithText text="加粗文字" className="[&>span]:font-bold" />

        <DividerWithText text="彩色文字" className="[&>span]:text-blue-600 [&>span]:dark:text-blue-400" />

        <DividerWithText text="较大文字" className="[&>span]:text-sm" />

        <DividerWithText
          text="带背景的文字"
          className="[&>span]:bg-gray-100 [&>span]:dark:bg-gray-800 [&>span]:px-2 [&>span]:py-1 [&>span]:rounded"
        />
      </div>
    </div>
  )
}

export const Timeline: Story = {
  render: () => (
    <div className="space-y-4">
      <h3 className="text-lg font-medium">项目时间线</h3>

      <div className="space-y-3">
        <div className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded">
          <h4 className="font-medium">项目启动</h4>
          <p className="text-sm text-gray-600 dark:text-gray-400">确定项目需求和目标</p>
        </div>

        <DividerWithText text="2024年1月" />

        <div className="p-3 bg-green-50 dark:bg-green-900/20 rounded">
          <h4 className="font-medium">开发阶段</h4>
          <p className="text-sm text-gray-600 dark:text-gray-400">功能开发和测试</p>
        </div>

        <DividerWithText text="2024年3月" />

        <div className="p-3 bg-yellow-50 dark:bg-yellow-900/20 rounded">
          <h4 className="font-medium">测试阶段</h4>
          <p className="text-sm text-gray-600 dark:text-gray-400">全面测试和优化</p>
        </div>

        <DividerWithText text="2024年5月" />

        <div className="p-3 bg-purple-50 dark:bg-purple-900/20 rounded">
          <h4 className="font-medium">发布上线</h4>
          <p className="text-sm text-gray-600 dark:text-gray-400">正式发布产品</p>
        </div>
      </div>
    </div>
  )
}
