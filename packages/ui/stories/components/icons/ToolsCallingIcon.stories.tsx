import type { Meta, StoryObj } from '@storybook/react'

import ToolsCallingIcon from '../../../src/components/icons/ToolsCallingIcon'

const meta: Meta<typeof ToolsCallingIcon> = {
  title: 'Components/Icons/ToolsCallingIcon',
  component: ToolsCallingIcon,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          '⚠️ **已废弃** - 此组件使用频率仅为 1 次，不符合 UI 库提取标准（需 ≥3 次）。计划在未来版本中移除。建议直接使用 lucide-react 的 Wrench 图标。'
      }
    }
  },
  tags: ['autodocs', 'deprecated'],
  argTypes: {
    className: {
      description: '容器的自定义 CSS 类名',
      control: { type: 'text' }
    },
    iconClassName: {
      description: '图标的自定义 CSS 类名',
      control: { type: 'text' }
    }
  }
}

export default meta
type Story = StoryObj<typeof meta>

// Basic Tools Calling Icon
export const BasicToolsCallingIcon: Story = {
  render: () => (
    <div className="space-y-6">
      <div>
        <h3 className="mb-3 font-semibold">基础工具调用图标</h3>
        <div className="flex items-center gap-4">
          <ToolsCallingIcon />
        </div>
        <p className="mt-2 text-sm text-gray-600">悬停图标查看工具提示，显示"函数调用"文本</p>
      </div>
    </div>
  )
}

// Different Sizes
export const DifferentSizes: Story = {
  render: () => (
    <div className="space-y-6">
      <div>
        <h3 className="mb-3 font-semibold">不同尺寸的工具调用图标</h3>
        <div className="flex items-end gap-6">
          <div className="flex flex-col items-center gap-2">
            <ToolsCallingIcon iconClassName="w-3 h-3" />
            <span className="text-xs text-gray-600">小号</span>
          </div>
          <div className="flex flex-col items-center gap-2">
            <ToolsCallingIcon />
            <span className="text-xs text-gray-600">默认</span>
          </div>
          <div className="flex flex-col items-center gap-2">
            <ToolsCallingIcon iconClassName="w-5 h-5" />
            <span className="text-xs text-gray-600">中号</span>
          </div>
          <div className="flex flex-col items-center gap-2">
            <ToolsCallingIcon iconClassName="w-6 h-6" />
            <span className="text-xs text-gray-600">大号</span>
          </div>
          <div className="flex flex-col items-center gap-2">
            <ToolsCallingIcon iconClassName="w-8 h-8" />
            <span className="text-xs text-gray-600">特大号</span>
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
        <h3 className="mb-3 font-semibold">不同颜色的工具调用图标</h3>
        <div className="flex items-center gap-6">
          <div className="flex flex-col items-center gap-2">
            <ToolsCallingIcon />
            <span className="text-xs text-gray-600">默认绿色</span>
          </div>
          <div className="flex flex-col items-center gap-2">
            <ToolsCallingIcon iconClassName="w-4 h-4 mr-1.5 text-blue-500" />
            <span className="text-xs text-gray-600">蓝色</span>
          </div>
          <div className="flex flex-col items-center gap-2">
            <ToolsCallingIcon iconClassName="w-4 h-4 mr-1.5 text-orange-500" />
            <span className="text-xs text-gray-600">橙色</span>
          </div>
          <div className="flex flex-col items-center gap-2">
            <ToolsCallingIcon iconClassName="w-4 h-4 mr-1.5 text-red-500" />
            <span className="text-xs text-gray-600">红色</span>
          </div>
          <div className="flex flex-col items-center gap-2">
            <ToolsCallingIcon iconClassName="w-4 h-4 mr-1.5 text-purple-500" />
            <span className="text-xs text-gray-600">紫色</span>
          </div>
          <div className="flex flex-col items-center gap-2">
            <ToolsCallingIcon iconClassName="w-4 h-4 mr-1.5 text-gray-500" />
            <span className="text-xs text-gray-600">灰色</span>
          </div>
        </div>
      </div>
    </div>
  )
}

// Model Features Context
export const ModelFeaturesContext: Story = {
  render: () => (
    <div className="space-y-4">
      <h3 className="mb-3 font-semibold">在模型功能标识中的使用</h3>

      <div className="grid gap-4">
        <div className="rounded-lg border border-gray-200 p-4">
          <div className="mb-2 flex items-center gap-2">
            <h4 className="font-medium">GPT-4 Turbo</h4>
            <ToolsCallingIcon />
          </div>
          <p className="text-sm text-gray-600">支持函数调用的先进模型，可以调用外部工具和API</p>
          <div className="mt-2 flex gap-2">
            <span className="rounded bg-green-100 px-2 py-1 text-xs text-green-800">函数调用</span>
            <span className="rounded bg-blue-100 px-2 py-1 text-xs text-blue-800">多模态</span>
          </div>
        </div>

        <div className="rounded-lg border border-gray-200 p-4">
          <div className="mb-2 flex items-center gap-2">
            <h4 className="font-medium">Claude 3.5 Sonnet</h4>
            <ToolsCallingIcon />
          </div>
          <p className="text-sm text-gray-600">Anthropic的高性能模型，具备强大的工具使用能力</p>
          <div className="mt-2 flex gap-2">
            <span className="rounded bg-green-100 px-2 py-1 text-xs text-green-800">函数调用</span>
            <span className="rounded bg-orange-100 px-2 py-1 text-xs text-orange-800">推理</span>
          </div>
        </div>

        <div className="rounded-lg border border-gray-200 p-4">
          <div className="mb-2 flex items-center gap-2">
            <h4 className="font-medium">Llama 3.1 8B</h4>
            {/* 不支持函数调用 */}
          </div>
          <p className="text-sm text-gray-600">Meta的开源模型，适用于基础对话任务</p>
          <div className="mt-2 flex gap-2">
            <span className="rounded bg-gray-100 px-2 py-1 text-xs text-gray-800">文本生成</span>
          </div>
        </div>
      </div>
    </div>
  )
}

// Chat Message Context
export const ChatMessageContext: Story = {
  render: () => (
    <div className="space-y-4">
      <h3 className="mb-3 font-semibold">在聊天消息中的使用</h3>

      <div className="space-y-3">
        <div className="rounded-lg bg-blue-50 p-3">
          <div className="mb-1 flex items-center gap-2 text-sm text-blue-800">
            <ToolsCallingIcon iconClassName="w-3.5 h-3.5 mr-1 text-[#00b96b]" />
            <span className="font-medium">调用工具: weather_api</span>
          </div>
          <p className="text-sm text-blue-700">正在获取北京的天气信息...</p>
        </div>

        <div className="rounded-lg bg-green-50 p-3">
          <div className="mb-1 flex items-center gap-2 text-sm text-green-800">
            <ToolsCallingIcon iconClassName="w-3.5 h-3.5 mr-1 text-[#00b96b]" />
            <span className="font-medium">调用工具: search_web</span>
          </div>
          <p className="text-sm text-green-700">正在搜索最新的AI新闻...</p>
        </div>

        <div className="rounded-lg bg-orange-50 p-3">
          <div className="mb-1 flex items-center gap-2 text-sm text-orange-800">
            <ToolsCallingIcon iconClassName="w-3.5 h-3.5 mr-1 text-[#00b96b]" />
            <span className="font-medium">调用工具: code_interpreter</span>
          </div>
          <p className="text-sm text-orange-700">正在执行Python代码计算结果...</p>
        </div>
      </div>
    </div>
  )
}

// Tool Availability Indicator
export const ToolAvailabilityIndicator: Story = {
  render: () => (
    <div className="space-y-4">
      <h3 className="mb-3 font-semibold">工具可用性指示器</h3>

      <div className="rounded-lg border border-gray-200">
        <div className="border-b border-gray-200 p-3">
          <h4 className="font-medium text-gray-900">可用工具</h4>
        </div>

        <div className="divide-y divide-gray-200">
          <div className="flex items-center justify-between p-3 hover:bg-gray-50">
            <div className="flex items-center gap-2">
              <ToolsCallingIcon iconClassName="w-4 h-4 mr-1.5 text-[#00b96b]" />
              <span className="font-medium">天气查询</span>
            </div>
            <span className="rounded-full bg-green-100 px-2 py-1 text-xs text-green-800">可用</span>
          </div>

          <div className="flex items-center justify-between p-3 hover:bg-gray-50">
            <div className="flex items-center gap-2">
              <ToolsCallingIcon iconClassName="w-4 h-4 mr-1.5 text-[#00b96b]" />
              <span className="font-medium">网络搜索</span>
            </div>
            <span className="rounded-full bg-green-100 px-2 py-1 text-xs text-green-800">可用</span>
          </div>

          <div className="flex items-center justify-between p-3 hover:bg-gray-50 opacity-60">
            <div className="flex items-center gap-2">
              <ToolsCallingIcon iconClassName="w-4 h-4 mr-1.5 text-gray-400" />
              <span className="font-medium">代码执行</span>
            </div>
            <span className="rounded-full bg-gray-100 px-2 py-1 text-xs text-gray-800">不可用</span>
          </div>

          <div className="flex items-center justify-between p-3 hover:bg-gray-50">
            <div className="flex items-center gap-2">
              <ToolsCallingIcon iconClassName="w-4 h-4 mr-1.5 text-yellow-600" />
              <span className="font-medium">图像生成</span>
            </div>
            <span className="rounded-full bg-yellow-100 px-2 py-1 text-xs text-yellow-800">限制使用</span>
          </div>
        </div>
      </div>
    </div>
  )
}

// Interactive Tool Selection
export const InteractiveToolSelection: Story = {
  render: () => {
    const tools = [
      { name: '天气查询', description: '获取实时天气信息', available: true },
      { name: '网络搜索', description: '搜索最新信息', available: true },
      { name: '代码执行', description: '运行Python代码', available: false },
      { name: '图像分析', description: '分析和描述图像', available: true },
      { name: '数据可视化', description: '创建图表和图形', available: false }
    ]

    return (
      <div className="space-y-4">
        <h3 className="mb-3 font-semibold">交互式工具选择器</h3>

        <div className="grid grid-cols-1 gap-3">
          {tools.map((tool, index) => (
            <button
              key={index}
              type="button"
              className={`flex items-center gap-3 rounded-lg border p-3 text-left transition-all hover:shadow-md focus:outline-none focus:ring-2 focus:ring-blue-500/20 ${
                tool.available
                  ? 'border-gray-200 hover:border-blue-500'
                  : 'border-gray-200 opacity-60 cursor-not-allowed'
              }`}
              disabled={!tool.available}>
              <ToolsCallingIcon
                iconClassName={`w-4 h-4 mr-1.5 ${tool.available ? 'text-[#00b96b]' : 'text-gray-400'}`}
              />
              <div className="flex-1">
                <div className="font-medium">{tool.name}</div>
                <div className="text-sm text-gray-600">{tool.description}</div>
              </div>
              <div className="text-xs">
                {tool.available ? (
                  <span className="rounded bg-green-100 px-2 py-1 text-green-800">可用</span>
                ) : (
                  <span className="rounded bg-gray-100 px-2 py-1 text-gray-800">不可用</span>
                )}
              </div>
            </button>
          ))}
        </div>
      </div>
    )
  }
}

// Loading Tool Calls
export const LoadingToolCalls: Story = {
  render: () => (
    <div className="space-y-4">
      <h3 className="mb-3 font-semibold">工具调用加载状态</h3>

      <div className="space-y-3">
        <div className="rounded-lg border border-gray-200 p-3">
          <div className="flex items-center gap-2">
            <ToolsCallingIcon />
            <span className="font-medium">正在调用工具...</span>
            <div className="h-2 w-2 animate-pulse rounded-full bg-green-500"></div>
          </div>
          <p className="mt-1 text-sm text-gray-600">weather_api(city="北京")</p>
        </div>

        <div className="rounded-lg border border-green-200 bg-green-50 p-3">
          <div className="flex items-center gap-2">
            <ToolsCallingIcon iconClassName="w-4 h-4 mr-1.5 text-green-600" />
            <span className="font-medium text-green-800">工具调用完成</span>
            <span className="text-green-600">✓</span>
          </div>
          <p className="mt-1 text-sm text-green-700">已获取北京天气信息：晴天，温度 22°C</p>
        </div>

        <div className="rounded-lg border border-red-200 bg-red-50 p-3">
          <div className="flex items-center gap-2">
            <ToolsCallingIcon iconClassName="w-4 h-4 mr-1.5 text-red-600" />
            <span className="font-medium text-red-800">工具调用失败</span>
            <span className="text-red-600">✗</span>
          </div>
          <p className="mt-1 text-sm text-red-700">API密钥无效，请检查配置</p>
        </div>
      </div>
    </div>
  )
}

// Settings Panel
export const SettingsPanel: Story = {
  render: () => (
    <div className="space-y-4">
      <h3 className="mb-3 font-semibold">设置面板中的使用</h3>

      <div className="rounded-lg border border-gray-200 p-4">
        <div className="mb-4 flex items-center gap-2">
          <ToolsCallingIcon />
          <h4 className="font-medium">函数调用设置</h4>
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <div className="font-medium">启用函数调用</div>
              <div className="text-sm text-gray-600">允许AI模型调用外部工具</div>
            </div>
            <input type="checkbox" className="rounded" defaultChecked />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <div className="font-medium">自动确认调用</div>
              <div className="text-sm text-gray-600">自动执行安全的工具调用</div>
            </div>
            <input type="checkbox" className="rounded" />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <div className="font-medium">显示调用详情</div>
              <div className="text-sm text-gray-600">在聊天中显示工具调用过程</div>
            </div>
            <input type="checkbox" className="rounded" defaultChecked />
          </div>
        </div>
      </div>
    </div>
  )
}
