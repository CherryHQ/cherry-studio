import type { Meta, StoryObj } from '@storybook/react'
import { useState } from 'react'

import type { CustomFallbackProps } from '../../../src/components'
import { Button } from '../../../src/components'
import { ErrorBoundary } from '../../../src/components'

// 错误组件 - 用于触发错误
const ThrowErrorComponent = ({ shouldThrow = false, errorMessage = '这是一个模拟错误' }) => {
  if (shouldThrow) {
    throw new Error(errorMessage)
  }
  return <div className="rounded bg-green-50 p-4 dark:bg-green-900/20">组件正常运行</div>
}

// 异步错误组件
const AsyncErrorComponent = () => {
  const [error, setError] = useState(false)

  const handleAsyncError = () => {
    setTimeout(() => {
      setError(true)
    }, 1000)
  }

  if (error) {
    throw new Error('异步操作失败')
  }

  return (
    <div className="space-y-2 p-4">
      <p>这是一个可以触发异步错误的组件</p>
      <Button onClick={handleAsyncError}>1秒后触发错误</Button>
    </div>
  )
}

const meta: Meta<typeof ErrorBoundary> = {
  title: 'Components/Primitives/error-boundary',
  component: ErrorBoundary,
  parameters: {
    layout: 'padded'
  },
  tags: ['autodocs'],
  argTypes: {
    children: {
      control: false,
      description: '被错误边界包裹的子组件'
    },
    fallbackComponent: {
      control: false,
      description: '自定义错误回退组件'
    },
    onDebugClick: {
      control: false,
      description: '调试按钮点击回调'
    },
    onReloadClick: {
      control: false,
      description: '重新加载按钮点击回调'
    },
    debugButtonText: {
      control: 'text',
      description: '调试按钮文字'
    },
    reloadButtonText: {
      control: 'text',
      description: '重新加载按钮文字'
    },
    errorMessage: {
      control: 'text',
      description: '错误消息标题'
    }
  }
}

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: () => (
    <ErrorBoundary>
      <ThrowErrorComponent shouldThrow={true} />
    </ErrorBoundary>
  )
}

export const CustomErrorMessage: Story = {
  render: () => (
    <ErrorBoundary errorMessage="自定义错误消息">
      <ThrowErrorComponent shouldThrow={true} errorMessage="这是一个自定义的错误消息" />
    </ErrorBoundary>
  )
}

export const WithDebugButton: Story = {
  render: () => (
    <ErrorBoundary onDebugClick={() => alert('打开调试工具')} debugButtonText="打开调试">
      <ThrowErrorComponent shouldThrow={true} />
    </ErrorBoundary>
  )
}

export const WithReloadButton: Story = {
  render: () => (
    <ErrorBoundary onReloadClick={() => window.location.reload()} reloadButtonText="重新加载页面">
      <ThrowErrorComponent shouldThrow={true} />
    </ErrorBoundary>
  )
}

export const WithBothButtons: Story = {
  render: () => (
    <ErrorBoundary
      onDebugClick={() => alert('打开开发者工具')}
      onReloadClick={() => alert('重新加载应用')}
      debugButtonText="调试"
      reloadButtonText="重载"
      errorMessage="应用程序遇到错误">
      <ThrowErrorComponent shouldThrow={true} errorMessage="组件渲染失败" />
    </ErrorBoundary>
  )
}

export const NoError: Story = {
  render: () => (
    <ErrorBoundary>
      <ThrowErrorComponent shouldThrow={false} />
    </ErrorBoundary>
  )
}

export const InteractiveDemo: Story = {
  render: function InteractiveDemo() {
    const [shouldThrow, setShouldThrow] = useState(false)
    const [errorMessage, setErrorMessage] = useState('用户触发的错误')

    return (
      <div className="space-y-4">
        <div className="flex gap-2">
          <Button variant={shouldThrow ? 'destructive' : 'default'} onClick={() => setShouldThrow(!shouldThrow)}>
            {shouldThrow ? '取消错误' : '触发错误'}
          </Button>
          <input
            type="text"
            value={errorMessage}
            onChange={(e) => setErrorMessage(e.target.value)}
            placeholder="自定义错误消息"
            className="rounded border border-gray-300 px-3 py-1 text-sm"
          />
        </div>

        <ErrorBoundary
          key={shouldThrow ? 'error' : 'normal'} // 重置错误边界
          onDebugClick={() => console.log('Debug clicked')}
          onReloadClick={() => setShouldThrow(false)}
          debugButtonText="控制台调试"
          reloadButtonText="重置组件"
          errorMessage="交互式错误演示">
          <ThrowErrorComponent shouldThrow={shouldThrow} errorMessage={errorMessage} />
        </ErrorBoundary>
      </div>
    )
  }
}

export const CustomFallback: Story = {
  render: () => {
    const CustomFallbackComponent = ({ error, onDebugClick, onReloadClick }: CustomFallbackProps) => (
      <div className="flex w-full items-center justify-center p-8">
        <div className="rounded-lg bg-gradient-to-r from-purple-400 to-pink-400 p-6 text-center text-white">
          <h2 className="mb-2 text-xl font-bold">😵 哎呀！</h2>
          <p className="mb-4">看起来出了点小问题...</p>
          <p className="mb-4 text-sm opacity-90">{error?.message}</p>
          <div className="flex justify-center gap-2">
            {onDebugClick && (
              <Button size="sm" variant="outline" onClick={onDebugClick}>
                检查错误
              </Button>
            )}
            {onReloadClick && (
              <Button size="sm" variant="outline" onClick={onReloadClick}>
                重试
              </Button>
            )}
          </div>
        </div>
      </div>
    )

    return (
      <ErrorBoundary
        fallbackComponent={CustomFallbackComponent}
        onDebugClick={() => alert('自定义调试')}
        onReloadClick={() => alert('自定义重载')}>
        <ThrowErrorComponent shouldThrow={true} errorMessage="使用自定义回退组件" />
      </ErrorBoundary>
    )
  }
}

export const NestedErrorBoundaries: Story = {
  render: () => (
    <div className="space-y-4">
      <h3 className="text-lg font-medium">嵌套错误边界</h3>

      <ErrorBoundary errorMessage="外层错误边界">
        <div className="rounded border border-gray-200 p-4 dark:border-gray-700">
          <h4 className="mb-2 font-medium">外层容器</h4>
          <p className="mb-4 text-sm text-gray-600 dark:text-gray-400">这个容器有自己的错误边界</p>

          <ErrorBoundary errorMessage="内层错误边界">
            <div className="rounded bg-gray-50 p-3 dark:bg-gray-800">
              <h5 className="mb-2 font-medium">内层容器</h5>
              <ThrowErrorComponent shouldThrow={true} errorMessage="内层组件错误" />
            </div>
          </ErrorBoundary>
        </div>
      </ErrorBoundary>
    </div>
  )
}

export const MultipleComponents: Story = {
  render: () => (
    <div className="space-y-4">
      <h3 className="text-lg font-medium">多个组件保护</h3>

      <ErrorBoundary onReloadClick={() => window.location.reload()} reloadButtonText="刷新页面">
        <div className="grid grid-cols-2 gap-4">
          <ThrowErrorComponent shouldThrow={false} />
          <ThrowErrorComponent shouldThrow={false} />
          <ThrowErrorComponent shouldThrow={true} errorMessage="其中一个组件出错" />
          <ThrowErrorComponent shouldThrow={false} />
        </div>
      </ErrorBoundary>
    </div>
  )
}

export const AsyncError: Story = {
  render: () => (
    <ErrorBoundary
      onReloadClick={() => window.location.reload()}
      reloadButtonText="重新加载"
      errorMessage="异步操作失败">
      <AsyncErrorComponent />
    </ErrorBoundary>
  )
}
