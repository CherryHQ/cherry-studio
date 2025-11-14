import type { Meta, StoryObj } from '@storybook/react'

import SvgSpinners180Ring from '../../../src/components/icons/SvgSpinners180Ring'

const meta: Meta<typeof SvgSpinners180Ring> = {
  title: 'Components/Icons/SvgSpinners180Ring',
  component: SvgSpinners180Ring,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          '⚠️ **已废弃** - 此组件使用频率为 0 次，不符合 UI 库提取标准（需 ≥3 次）。计划在未来版本中移除。虽然主项目中有本地副本，但完全未被导入使用。'
      }
    }
  },
  tags: ['autodocs', 'deprecated'],
  argTypes: {
    size: {
      description: '加载图标大小',
      control: { type: 'text' },
      defaultValue: '1em'
    },
    className: {
      description: '自定义 CSS 类名',
      control: { type: 'text' }
    }
  }
}

export default meta
type Story = StoryObj<typeof meta>

// Basic Spinner
export const BasicSpinner: Story = {
  render: () => (
    <div className="space-y-6">
      <div>
        <h3 className="mb-3 font-semibold">基础加载动画</h3>
        <div className="flex items-center gap-4">
          <SvgSpinners180Ring />
          <span className="text-sm text-gray-600">默认尺寸 (1em)</span>
        </div>
      </div>
    </div>
  )
}

// Different Sizes
export const DifferentSizes: Story = {
  render: () => (
    <div className="space-y-6">
      <div>
        <h3 className="mb-3 font-semibold">不同尺寸的加载动画</h3>
        <div className="flex items-end gap-6">
          <div className="flex flex-col items-center gap-2">
            <SvgSpinners180Ring size="12" />
            <span className="text-xs text-gray-600">12px</span>
          </div>
          <div className="flex flex-col items-center gap-2">
            <SvgSpinners180Ring size="16" />
            <span className="text-xs text-gray-600">16px</span>
          </div>
          <div className="flex flex-col items-center gap-2">
            <SvgSpinners180Ring size="20" />
            <span className="text-xs text-gray-600">20px</span>
          </div>
          <div className="flex flex-col items-center gap-2">
            <SvgSpinners180Ring size="24" />
            <span className="text-xs text-gray-600">24px</span>
          </div>
          <div className="flex flex-col items-center gap-2">
            <SvgSpinners180Ring size="32" />
            <span className="text-xs text-gray-600">32px</span>
          </div>
          <div className="flex flex-col items-center gap-2">
            <SvgSpinners180Ring size="48" />
            <span className="text-xs text-gray-600">48px</span>
          </div>
        </div>
      </div>
    </div>
  )
}

// Different Colors
export const DifferentColors: Story = {
  render: () => (
    <div className="space-y-6">
      <div>
        <h3 className="mb-3 font-semibold">不同颜色的加载动画</h3>
        <div className="flex items-center gap-6">
          <div className="flex flex-col items-center gap-2">
            <SvgSpinners180Ring size="24" className="text-blue-500" />
            <span className="text-xs text-gray-600">蓝色</span>
          </div>
          <div className="flex flex-col items-center gap-2">
            <SvgSpinners180Ring size="24" className="text-green-500" />
            <span className="text-xs text-gray-600">绿色</span>
          </div>
          <div className="flex flex-col items-center gap-2">
            <SvgSpinners180Ring size="24" className="text-orange-500" />
            <span className="text-xs text-gray-600">橙色</span>
          </div>
          <div className="flex flex-col items-center gap-2">
            <SvgSpinners180Ring size="24" className="text-red-500" />
            <span className="text-xs text-gray-600">红色</span>
          </div>
          <div className="flex flex-col items-center gap-2">
            <SvgSpinners180Ring size="24" className="text-purple-500" />
            <span className="text-xs text-gray-600">紫色</span>
          </div>
          <div className="flex flex-col items-center gap-2">
            <SvgSpinners180Ring size="24" className="text-gray-500" />
            <span className="text-xs text-gray-600">灰色</span>
          </div>
        </div>
      </div>
    </div>
  )
}

// Loading States in Buttons
export const LoadingStatesInButtons: Story = {
  render: () => (
    <div className="space-y-6">
      <div>
        <h3 className="mb-3 font-semibold">按钮中的加载状态</h3>
        <div className="flex flex-wrap items-center gap-4">
          <button
            type="button"
            className="flex items-center gap-2 rounded bg-blue-500 px-4 py-2 text-white hover:bg-blue-600"
            disabled>
            <SvgSpinners180Ring size="16" />
            <span>加载中...</span>
          </button>

          <button
            type="button"
            className="flex items-center gap-2 rounded bg-green-500 px-4 py-2 text-white hover:bg-green-600"
            disabled>
            <SvgSpinners180Ring size="16" />
            <span>保存中</span>
          </button>

          <button
            type="button"
            className="flex items-center gap-2 rounded bg-orange-500 px-4 py-2 text-white hover:bg-orange-600"
            disabled>
            <SvgSpinners180Ring size="16" />
            <span>上传中</span>
          </button>

          <button
            type="button"
            className="flex items-center gap-2 rounded border border-gray-300 bg-white px-4 py-2 text-gray-700 hover:bg-gray-50"
            disabled>
            <SvgSpinners180Ring size="16" className="text-gray-500" />
            <span>处理中</span>
          </button>
        </div>
      </div>
    </div>
  )
}

// Loading Cards
export const LoadingCards: Story = {
  render: () => (
    <div className="space-y-6">
      <div>
        <h3 className="mb-3 font-semibold">加载状态卡片</h3>
        <div className="grid grid-cols-2 gap-4">
          <div className="rounded-lg border border-gray-200 p-4">
            <div className="flex items-center gap-3">
              <SvgSpinners180Ring size="20" className="text-blue-500" />
              <div>
                <h4 className="font-medium">AI 模型响应中</h4>
                <p className="text-sm text-gray-600">正在生成回复...</p>
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-gray-200 p-4">
            <div className="flex items-center gap-3">
              <SvgSpinners180Ring size="20" className="text-green-500" />
              <div>
                <h4 className="font-medium">文件上传中</h4>
                <p className="text-sm text-gray-600">75% 完成</p>
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-gray-200 p-4">
            <div className="flex items-center gap-3">
              <SvgSpinners180Ring size="20" className="text-orange-500" />
              <div>
                <h4 className="font-medium">数据同步中</h4>
                <p className="text-sm text-gray-600">请稍候...</p>
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-gray-200 p-4">
            <div className="flex items-center gap-3">
              <SvgSpinners180Ring size="20" className="text-purple-500" />
              <div>
                <h4 className="font-medium">模型训练中</h4>
                <p className="text-sm text-gray-600">预计2分钟</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// Inline Loading States
export const InlineLoadingStates: Story = {
  render: () => (
    <div className="space-y-6">
      <div>
        <h3 className="mb-3 font-semibold">行内加载状态</h3>
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <SvgSpinners180Ring size="14" className="text-blue-500" />
            <span className="text-sm">正在检查网络连接...</span>
          </div>

          <div className="flex items-center gap-2">
            <SvgSpinners180Ring size="14" className="text-green-500" />
            <span className="text-sm">正在保存更改...</span>
          </div>

          <div className="flex items-center gap-2">
            <SvgSpinners180Ring size="14" className="text-orange-500" />
            <span className="text-sm">正在验证凭据...</span>
          </div>

          <div className="rounded bg-blue-50 p-3">
            <div className="flex items-center gap-2">
              <SvgSpinners180Ring size="16" className="text-blue-600" />
              <span className="text-sm text-blue-800">系统正在处理您的请求，请稍候...</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// Loading States with Different Speeds
export const LoadingStatesWithDifferentSpeeds: Story = {
  render: () => (
    <div className="space-y-6">
      <div>
        <h3 className="mb-3 font-semibold">不同速度的加载动画</h3>
        <div className="flex items-center gap-6">
          <div className="flex flex-col items-center gap-2">
            <SvgSpinners180Ring size="24" className="animate-spin" style={{ animationDuration: '2s' }} />
            <span className="text-xs text-gray-600">慢速 (2s)</span>
          </div>
          <div className="flex flex-col items-center gap-2">
            <SvgSpinners180Ring size="24" />
            <span className="text-xs text-gray-600">默认速度</span>
          </div>
          <div className="flex flex-col items-center gap-2">
            <SvgSpinners180Ring size="24" className="animate-spin" style={{ animationDuration: '0.5s' }} />
            <span className="text-xs text-gray-600">快速 (0.5s)</span>
          </div>
        </div>
      </div>
    </div>
  )
}

// Full Page Loading
export const FullPageLoading: Story = {
  render: () => (
    <div className="space-y-6">
      <div>
        <h3 className="mb-3 font-semibold">全屏加载示例</h3>
        <div className="relative h-64 w-full overflow-hidden rounded-lg border border-gray-200 bg-white">
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-white/80">
            <SvgSpinners180Ring size="32" className="text-blue-500" />
            <p className="mt-4 text-sm text-gray-600">页面加载中，请稍候...</p>
          </div>

          {/* 模拟页面内容 */}
          <div className="p-6 opacity-30">
            <div className="mb-4 h-6 w-1/3 rounded bg-gray-200"></div>
            <div className="mb-2 h-4 w-full rounded bg-gray-200"></div>
            <div className="mb-2 h-4 w-5/6 rounded bg-gray-200"></div>
            <div className="mb-4 h-4 w-4/6 rounded bg-gray-200"></div>
            <div className="mb-2 h-4 w-full rounded bg-gray-200"></div>
            <div className="h-4 w-3/4 rounded bg-gray-200"></div>
          </div>
        </div>
      </div>
    </div>
  )
}

// Interactive Loading Demo
export const InteractiveLoadingDemo: Story = {
  render: () => {
    const loadingStates = [
      { text: '发送消息', color: 'text-blue-500', bgColor: 'bg-blue-500' },
      { text: '上传文件', color: 'text-green-500', bgColor: 'bg-green-500' },
      { text: '生成内容', color: 'text-purple-500', bgColor: 'bg-purple-500' },
      { text: '搜索结果', color: 'text-orange-500', bgColor: 'bg-orange-500' }
    ]

    return (
      <div className="space-y-4">
        <h3 className="mb-3 font-semibold">交互式加载演示</h3>

        <div className="grid grid-cols-2 gap-4">
          {loadingStates.map((state, index) => (
            <button
              key={index}
              type="button"
              className={`flex items-center justify-center gap-2 rounded-lg ${state.bgColor} px-4 py-3 text-white transition-all hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-offset-2`}
              onClick={() => {
                // 演示用途 - 在实际应用中这里会触发真实的加载状态
                alert(`触发 ${state.text} 加载状态`)
              }}>
              <SvgSpinners180Ring size="16" />
              <span>{state.text}中...</span>
            </button>
          ))}
        </div>

        <p className="text-xs text-gray-500">点击按钮查看加载状态的交互效果</p>
      </div>
    )
  }
}
