import { Button } from '@heroui/react'
import type { Meta, StoryObj } from '@storybook/react'
import { useState } from 'react'

import Spinner from '../../../src/components/base/Spinner'

const meta: Meta<typeof Spinner> = {
  title: 'Base/Spinner',
  component: Spinner,
  parameters: {
    layout: 'centered'
  },
  tags: ['autodocs'],
  argTypes: {
    text: {
      control: false,
      description: '加载文字或React节点'
    }
  }
}

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: {
    text: '加载中...'
  }
}

export const ShortText: Story = {
  args: {
    text: '搜索'
  }
}

export const LongText: Story = {
  args: {
    text: '正在处理您的请求，请稍候'
  }
}

export const WithReactNode: Story = {
  args: {
    text: (
      <span>
        加载 <strong>数据</strong> 中...
      </span>
    )
  }
}

export const CustomStyle: Story = {
  args: {
    text: '自定义样式',
    className: 'bg-blue-50 dark:bg-blue-900/20 px-4 py-2 rounded-lg border border-blue-200 dark:border-blue-700'
  }
}

export const LoadingStates: Story = {
  render: () => (
    <div className="space-y-6">
      <h3 className="text-lg font-medium">不同加载状态</h3>
      <div className="space-y-4">
        <div>
          <h4 className="font-medium mb-2">文件操作</h4>
          <div className="space-y-2">
            <Spinner text="正在上传文件..." />
            <Spinner text="正在下载文件..." />
            <Spinner text="正在压缩文件..." />
          </div>
        </div>

        <div>
          <h4 className="font-medium mb-2">数据处理</h4>
          <div className="space-y-2">
            <Spinner text="正在加载数据..." />
            <Spinner text="正在保存更改..." />
            <Spinner text="正在同步数据..." />
          </div>
        </div>

        <div>
          <h4 className="font-medium mb-2">网络请求</h4>
          <div className="space-y-2">
            <Spinner text="正在连接服务器..." />
            <Spinner text="正在获取更新..." />
            <Spinner text="正在验证账户..." />
          </div>
        </div>
      </div>
    </div>
  )
}

export const InteractiveDemo: Story = {
  render: function InteractiveDemo() {
    const [isLoading, setIsLoading] = useState(false)
    const [loadingText, setLoadingText] = useState('处理中...')

    const handleStartLoading = () => {
      setIsLoading(true)
      setTimeout(() => {
        setIsLoading(false)
      }, 3000)
    }

    return (
      <div className="space-y-4">
        <div className="flex gap-2">
          <Button onPress={handleStartLoading} disabled={isLoading} color="primary">
            {isLoading ? '正在处理...' : '开始加载'}
          </Button>
          <input
            type="text"
            value={loadingText}
            onChange={(e) => setLoadingText(e.target.value)}
            placeholder="自定义加载文字"
            className="px-3 py-1 border border-gray-300 rounded text-sm"
            disabled={isLoading}
          />
        </div>

        {isLoading && (
          <div className="p-4 border border-gray-200 dark:border-gray-700 rounded">
            <Spinner text={loadingText} />
          </div>
        )}
      </div>
    )
  }
}

export const InComponents: Story = {
  render: () => (
    <div className="space-y-6">
      <h3 className="text-lg font-medium">组件中的应用</h3>

      <div className="space-y-4">
        {/* 搜索框 */}
        <div className="space-y-2">
          <h4 className="font-medium">搜索框</h4>
          <div className="relative">
            <input
              type="text"
              placeholder="搜索..."
              className="w-full px-4 py-2 pr-32 border border-gray-300 rounded-lg"
            />
            <div className="absolute right-2 top-1/2 transform -translate-y-1/2">
              <Spinner text="搜索中" />
            </div>
          </div>
        </div>

        {/* 按钮加载状态 */}
        <div className="space-y-2">
          <h4 className="font-medium">按钮加载状态</h4>
          <div className="flex gap-2">
            <Button disabled className="cursor-not-allowed opacity-70">
              <Spinner text="保存中..." className="text-sm" />
            </Button>
            <Button disabled className="cursor-not-allowed opacity-70">
              <Spinner text="提交中..." className="text-sm" />
            </Button>
          </div>
        </div>

        {/* 卡片加载 */}
        <div className="space-y-2">
          <h4 className="font-medium">卡片加载</h4>
          <div className="p-6 border border-gray-200 dark:border-gray-700 rounded-lg text-center">
            <Spinner text="正在加载内容..." />
          </div>
        </div>

        {/* 列表加载 */}
        <div className="space-y-2">
          <h4 className="font-medium">列表加载</h4>
          <div className="space-y-2">
            <div className="p-3 border border-gray-200 dark:border-gray-700 rounded">
              <p>已加载的项目 1</p>
            </div>
            <div className="p-3 border border-gray-200 dark:border-gray-700 rounded">
              <p>已加载的项目 2</p>
            </div>
            <div className="p-3 border border-gray-200 dark:border-gray-700 rounded text-center">
              <Spinner text="加载更多..." />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export const DifferentSizes: Story = {
  render: () => (
    <div className="space-y-6">
      <h3 className="text-lg font-medium">不同场景的尺寸</h3>
      <div className="space-y-4">
        <div className="flex items-center gap-4">
          <span className="w-20 text-sm">小尺寸:</span>
          <Spinner text="加载" className="text-xs" />
        </div>
        <div className="flex items-center gap-4">
          <span className="w-20 text-sm">默认:</span>
          <Spinner text="加载中..." />
        </div>
        <div className="flex items-center gap-4">
          <span className="w-20 text-sm">大尺寸:</span>
          <Spinner text="正在处理大量数据..." className="text-lg" />
        </div>
      </div>
    </div>
  )
}

export const ColorVariations: Story = {
  render: () => (
    <div className="space-y-6">
      <h3 className="text-lg font-medium">颜色变化</h3>
      <div className="space-y-4">
        <div className="space-y-2">
          <Spinner text="默认颜色" />
          <Spinner text="蓝色主题" className="text-blue-600 dark:text-blue-400" />
          <Spinner text="绿色成功" className="text-green-600 dark:text-green-400" />
          <Spinner text="橙色警告" className="text-orange-600 dark:text-orange-400" />
          <Spinner text="红色错误" className="text-red-600 dark:text-red-400" />
          <Spinner text="紫色特殊" className="text-purple-600 dark:text-purple-400" />
        </div>
      </div>
    </div>
  )
}

export const BackgroundVariations: Story = {
  render: () => (
    <div className="space-y-6">
      <h3 className="text-lg font-medium">背景变化</h3>
      <div className="space-y-4">
        <div className="p-4 bg-white dark:bg-gray-800 rounded border">
          <Spinner text="白色背景" />
        </div>
        <div className="p-4 bg-gray-100 dark:bg-gray-700 rounded">
          <Spinner text="灰色背景" />
        </div>
        <div className="p-4 bg-blue-500 text-white rounded">
          <Spinner text="蓝色背景" className="text-white" />
        </div>
        <div className="p-4 bg-green-500 text-white rounded">
          <Spinner text="绿色背景" className="text-white" />
        </div>
      </div>
    </div>
  )
}

export const LoadingSequence: Story = {
  render: function LoadingSequence() {
    const [step, setStep] = useState(0)
    const steps = ['准备中...', '连接服务器...', '验证身份...', '加载数据...', '处理结果...', '完成!']

    const nextStep = () => {
      setStep((prev) => (prev + 1) % steps.length)
    }

    const currentStep = steps[step]
    const isComplete = step === steps.length - 1

    return (
      <div className="space-y-4">
        <Button onPress={nextStep}>{isComplete ? '重新开始' : '下一步'}</Button>

        <div className="p-6 border border-gray-200 dark:border-gray-700 rounded-lg">
          {isComplete ? (
            <div className="text-center text-green-600 dark:text-green-400 font-medium">✅ {currentStep}</div>
          ) : (
            <Spinner text={currentStep} />
          )}
        </div>

        <div className="text-sm text-gray-500">
          步骤 {step + 1} / {steps.length}
        </div>
      </div>
    )
  }
}

export const RealWorldUsage: Story = {
  render: () => (
    <div className="space-y-6">
      <h3 className="text-lg font-medium">真实场景应用</h3>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* 表单提交 */}
        <div className="p-4 border border-gray-200 dark:border-gray-700 rounded">
          <h4 className="font-medium mb-3">表单提交</h4>
          <div className="space-y-3">
            <input type="email" placeholder="邮箱" className="w-full px-3 py-2 border border-gray-300 rounded" />
            <input type="password" placeholder="密码" className="w-full px-3 py-2 border border-gray-300 rounded" />
            <div className="text-center">
              <Spinner text="正在登录..." />
            </div>
          </div>
        </div>

        {/* 文件上传 */}
        <div className="p-4 border border-gray-200 dark:border-gray-700 rounded">
          <h4 className="font-medium mb-3">文件上传</h4>
          <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center">
            <Spinner text="上传中 (75%)" />
            <div className="mt-2 w-full bg-gray-200 rounded-full h-2">
              <div className="bg-blue-600 h-2 rounded-full" style={{ width: '75%' }}></div>
            </div>
          </div>
        </div>

        {/* 数据获取 */}
        <div className="p-4 border border-gray-200 dark:border-gray-700 rounded">
          <h4 className="font-medium mb-3">数据获取</h4>
          <div className="space-y-2">
            <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded animate-pulse"></div>
            <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded animate-pulse w-3/4"></div>
            <div className="text-center mt-4">
              <Spinner text="获取最新数据..." />
            </div>
          </div>
        </div>

        {/* 页面切换 */}
        <div className="p-4 border border-gray-200 dark:border-gray-700 rounded">
          <h4 className="font-medium mb-3">页面切换</h4>
          <div className="text-center">
            <div className="h-32 bg-gray-100 dark:bg-gray-700 rounded flex items-center justify-center">
              <Spinner text="加载页面..." />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
