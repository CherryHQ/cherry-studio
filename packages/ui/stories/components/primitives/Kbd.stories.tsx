import type { Meta, StoryObj } from '@storybook/react'
import { Command, Copy, Save, Search } from 'lucide-react'

import { Kbd, KbdGroup } from '../../../src/components/primitives/kbd'
import { Tooltip, TooltipContent, TooltipTrigger } from '../../../src/components/primitives/tooltip'

const meta: Meta<typeof Kbd> = {
  title: 'Components/Primitives/Kbd',
  component: Kbd,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: '用于显示键盘快捷键的组件,支持单个按键和组合快捷键'
      }
    }
  },
  tags: ['autodocs'],
  argTypes: {
    className: {
      control: { type: 'text' },
      description: '自定义 CSS 类名'
    },
    children: {
      control: { type: 'text' },
      description: '键盘按键内容'
    }
  }
}

export default meta
type Story = StoryObj<typeof meta>

// 基础示例
export const Default: Story = {
  args: {
    children: 'Ctrl'
  }
}

// 单个按键
export const SingleKeys: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      <Kbd>Ctrl</Kbd>
      <Kbd>Shift</Kbd>
      <Kbd>Alt</Kbd>
      <Kbd>Enter</Kbd>
      <Kbd>Esc</Kbd>
      <Kbd>Tab</Kbd>
      <Kbd>Space</Kbd>
      <Kbd>Delete</Kbd>
    </div>
  )
}

// 字母和数字按键
export const AlphanumericKeys: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      <Kbd>A</Kbd>
      <Kbd>B</Kbd>
      <Kbd>C</Kbd>
      <Kbd>1</Kbd>
      <Kbd>2</Kbd>
      <Kbd>3</Kbd>
      <Kbd>F1</Kbd>
      <Kbd>F2</Kbd>
      <Kbd>F12</Kbd>
    </div>
  )
}

// 方向键
export const ArrowKeys: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      <Kbd>↑</Kbd>
      <Kbd>↓</Kbd>
      <Kbd>←</Kbd>
      <Kbd>→</Kbd>
    </div>
  )
}

// 组合快捷键
export const KeyCombinations: Story = {
  render: () => (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <span className="w-24 text-sm text-muted-foreground">保存:</span>
        <KbdGroup>
          <Kbd>Ctrl</Kbd>
          <Kbd>S</Kbd>
        </KbdGroup>
      </div>
      <div className="flex items-center gap-2">
        <span className="w-24 text-sm text-muted-foreground">复制:</span>
        <KbdGroup>
          <Kbd>Ctrl</Kbd>
          <Kbd>C</Kbd>
        </KbdGroup>
      </div>
      <div className="flex items-center gap-2">
        <span className="w-24 text-sm text-muted-foreground">粘贴:</span>
        <KbdGroup>
          <Kbd>Ctrl</Kbd>
          <Kbd>V</Kbd>
        </KbdGroup>
      </div>
      <div className="flex items-center gap-2">
        <span className="w-24 text-sm text-muted-foreground">查找:</span>
        <KbdGroup>
          <Kbd>Ctrl</Kbd>
          <Kbd>F</Kbd>
        </KbdGroup>
      </div>
      <div className="flex items-center gap-2">
        <span className="w-24 text-sm text-muted-foreground">全选:</span>
        <KbdGroup>
          <Kbd>Ctrl</Kbd>
          <Kbd>A</Kbd>
        </KbdGroup>
      </div>
    </div>
  )
}

// Mac 快捷键
export const MacKeys: Story = {
  render: () => (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <span className="w-24 text-sm text-muted-foreground">保存:</span>
        <KbdGroup>
          <Kbd>⌘</Kbd>
          <Kbd>S</Kbd>
        </KbdGroup>
      </div>
      <div className="flex items-center gap-2">
        <span className="w-24 text-sm text-muted-foreground">复制:</span>
        <KbdGroup>
          <Kbd>⌘</Kbd>
          <Kbd>C</Kbd>
        </KbdGroup>
      </div>
      <div className="flex items-center gap-2">
        <span className="w-24 text-sm text-muted-foreground">粘贴:</span>
        <KbdGroup>
          <Kbd>⌘</Kbd>
          <Kbd>V</Kbd>
        </KbdGroup>
      </div>
      <div className="flex items-center gap-2">
        <span className="w-24 text-sm text-muted-foreground">截图:</span>
        <KbdGroup>
          <Kbd>⌘</Kbd>
          <Kbd>⇧</Kbd>
          <Kbd>4</Kbd>
        </KbdGroup>
      </div>
    </div>
  )
}

// 三键组合
export const ThreeKeyCombinations: Story = {
  render: () => (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <span className="w-32 text-sm text-muted-foreground">撤销:</span>
        <KbdGroup>
          <Kbd>Ctrl</Kbd>
          <Kbd>Shift</Kbd>
          <Kbd>Z</Kbd>
        </KbdGroup>
      </div>
      <div className="flex items-center gap-2">
        <span className="w-32 text-sm text-muted-foreground">重做:</span>
        <KbdGroup>
          <Kbd>Ctrl</Kbd>
          <Kbd>Alt</Kbd>
          <Kbd>Z</Kbd>
        </KbdGroup>
      </div>
      <div className="flex items-center gap-2">
        <span className="w-32 text-sm text-muted-foreground">格式化:</span>
        <KbdGroup>
          <Kbd>Ctrl</Kbd>
          <Kbd>Shift</Kbd>
          <Kbd>F</Kbd>
        </KbdGroup>
      </div>
    </div>
  )
}

// 带图标的按键
export const WithIcons: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      <Kbd>
        <Command />
      </Kbd>
      <Kbd>
        <Copy />
      </Kbd>
      <Kbd>
        <Save />
      </Kbd>
      <Kbd>
        <Search />
      </Kbd>
    </div>
  )
}

// 在 Tooltip 中使用
export const InTooltip: Story = {
  render: () => (
    <div className="flex flex-wrap gap-4">
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="rounded bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90">
            保存
          </button>
        </TooltipTrigger>
        <TooltipContent>
          <Kbd>Ctrl+S</Kbd>
        </TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="rounded bg-secondary px-4 py-2 text-sm font-medium text-secondary-foreground hover:bg-secondary/80">
            复制
          </button>
        </TooltipTrigger>
        <TooltipContent>
          <KbdGroup>
            <Kbd>Ctrl</Kbd>
            <Kbd>C</Kbd>
          </KbdGroup>
        </TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="rounded bg-secondary px-4 py-2 text-sm font-medium text-secondary-foreground hover:bg-secondary/80">
            粘贴
          </button>
        </TooltipTrigger>
        <TooltipContent>
          <KbdGroup>
            <Kbd>Ctrl</Kbd>
            <Kbd>V</Kbd>
          </KbdGroup>
        </TooltipContent>
      </Tooltip>
    </div>
  )
}

// 快捷键列表
export const ShortcutList: Story = {
  render: () => (
    <div className="w-96 space-y-2 rounded-lg border p-4">
      <h3 className="mb-3 text-base font-semibold">键盘快捷键</h3>
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-sm">保存文件</span>
          <KbdGroup>
            <Kbd>Ctrl</Kbd>
            <Kbd>S</Kbd>
          </KbdGroup>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-sm">打开文件</span>
          <KbdGroup>
            <Kbd>Ctrl</Kbd>
            <Kbd>O</Kbd>
          </KbdGroup>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-sm">查找</span>
          <KbdGroup>
            <Kbd>Ctrl</Kbd>
            <Kbd>F</Kbd>
          </KbdGroup>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-sm">替换</span>
          <KbdGroup>
            <Kbd>Ctrl</Kbd>
            <Kbd>H</Kbd>
          </KbdGroup>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-sm">撤销</span>
          <KbdGroup>
            <Kbd>Ctrl</Kbd>
            <Kbd>Z</Kbd>
          </KbdGroup>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-sm">重做</span>
          <KbdGroup>
            <Kbd>Ctrl</Kbd>
            <Kbd>Y</Kbd>
          </KbdGroup>
        </div>
      </div>
    </div>
  )
}

// 编辑器快捷键
export const EditorShortcuts: Story = {
  render: () => (
    <div className="w-[600px] space-y-4 rounded-lg border p-6">
      <h3 className="text-lg font-semibold">编辑器快捷键</h3>

      <div className="space-y-3">
        <div>
          <h4 className="mb-2 text-sm font-medium text-muted-foreground">文件操作</h4>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm">新建文件</span>
              <KbdGroup>
                <Kbd>Ctrl</Kbd>
                <Kbd>N</Kbd>
              </KbdGroup>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm">打开文件</span>
              <KbdGroup>
                <Kbd>Ctrl</Kbd>
                <Kbd>O</Kbd>
              </KbdGroup>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm">保存</span>
              <KbdGroup>
                <Kbd>Ctrl</Kbd>
                <Kbd>S</Kbd>
              </KbdGroup>
            </div>
          </div>
        </div>

        <div>
          <h4 className="mb-2 text-sm font-medium text-muted-foreground">编辑</h4>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm">复制</span>
              <KbdGroup>
                <Kbd>Ctrl</Kbd>
                <Kbd>C</Kbd>
              </KbdGroup>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm">剪切</span>
              <KbdGroup>
                <Kbd>Ctrl</Kbd>
                <Kbd>X</Kbd>
              </KbdGroup>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm">粘贴</span>
              <KbdGroup>
                <Kbd>Ctrl</Kbd>
                <Kbd>V</Kbd>
              </KbdGroup>
            </div>
          </div>
        </div>

        <div>
          <h4 className="mb-2 text-sm font-medium text-muted-foreground">导航</h4>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm">转到行</span>
              <KbdGroup>
                <Kbd>Ctrl</Kbd>
                <Kbd>G</Kbd>
              </KbdGroup>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm">查找</span>
              <KbdGroup>
                <Kbd>Ctrl</Kbd>
                <Kbd>F</Kbd>
              </KbdGroup>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm">全局搜索</span>
              <KbdGroup>
                <Kbd>Ctrl</Kbd>
                <Kbd>Shift</Kbd>
                <Kbd>F</Kbd>
              </KbdGroup>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// 游戏控制
export const GameControls: Story = {
  render: () => (
    <div className="w-96 space-y-4 rounded-lg border p-6">
      <h3 className="text-lg font-semibold">游戏控制</h3>

      <div className="space-y-3">
        <div>
          <h4 className="mb-2 text-sm font-medium text-muted-foreground">移动</h4>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm">向前</span>
              <Kbd>W</Kbd>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm">向后</span>
              <Kbd>S</Kbd>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm">向左</span>
              <Kbd>A</Kbd>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm">向右</span>
              <Kbd>D</Kbd>
            </div>
          </div>
        </div>

        <div>
          <h4 className="mb-2 text-sm font-medium text-muted-foreground">动作</h4>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm">跳跃</span>
              <Kbd>Space</Kbd>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm">冲刺</span>
              <Kbd>Shift</Kbd>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm">使用物品</span>
              <Kbd>E</Kbd>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// 特殊字符
export const SpecialCharacters: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      <Kbd>⌘</Kbd>
      <Kbd>⌥</Kbd>
      <Kbd>⇧</Kbd>
      <Kbd>⌃</Kbd>
      <Kbd>⏎</Kbd>
      <Kbd>⌫</Kbd>
      <Kbd>⌦</Kbd>
      <Kbd>⇥</Kbd>
      <Kbd>⎋</Kbd>
      <Kbd>⇪</Kbd>
    </div>
  )
}

// 不同尺寸 (通过自定义类名)
export const CustomSizes: Story = {
  render: () => (
    <div className="flex items-center gap-3">
      <Kbd className="h-4 min-w-4 text-[10px]">S</Kbd>
      <Kbd>M</Kbd>
      <Kbd className="h-6 min-w-6 text-sm">L</Kbd>
      <Kbd className="h-8 min-w-8 text-base">XL</Kbd>
    </div>
  )
}

// 实际应用示例
export const RealWorldExample: Story = {
  render: () => (
    <div className="w-[700px] space-y-6">
      <div className="rounded-lg border p-6">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold">命令面板</h3>
          <KbdGroup>
            <Kbd>Ctrl</Kbd>
            <Kbd>K</Kbd>
          </KbdGroup>
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between rounded-md p-2 hover:bg-muted">
            <div className="flex items-center gap-3">
              <Save className="h-4 w-4" />
              <span className="text-sm">保存当前文件</span>
            </div>
            <KbdGroup>
              <Kbd>Ctrl</Kbd>
              <Kbd>S</Kbd>
            </KbdGroup>
          </div>
          <div className="flex items-center justify-between rounded-md p-2 hover:bg-muted">
            <div className="flex items-center gap-3">
              <Copy className="h-4 w-4" />
              <span className="text-sm">复制选中内容</span>
            </div>
            <KbdGroup>
              <Kbd>Ctrl</Kbd>
              <Kbd>C</Kbd>
            </KbdGroup>
          </div>
          <div className="flex items-center justify-between rounded-md p-2 hover:bg-muted">
            <div className="flex items-center gap-3">
              <Search className="h-4 w-4" />
              <span className="text-sm">在文件中查找</span>
            </div>
            <KbdGroup>
              <Kbd>Ctrl</Kbd>
              <Kbd>F</Kbd>
            </KbdGroup>
          </div>
          <div className="flex items-center justify-between rounded-md p-2 hover:bg-muted">
            <div className="flex items-center gap-3">
              <Command className="h-4 w-4" />
              <span className="text-sm">显示所有命令</span>
            </div>
            <KbdGroup>
              <Kbd>Ctrl</Kbd>
              <Kbd>Shift</Kbd>
              <Kbd>P</Kbd>
            </KbdGroup>
          </div>
        </div>
      </div>

      <div className="rounded-lg border p-6">
        <h3 className="mb-4 text-lg font-semibold">提示信息</h3>
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            按 <Kbd>Ctrl</Kbd> 并点击链接可在新标签页中打开
          </p>
          <p className="text-sm text-muted-foreground">
            使用{' '}
            <KbdGroup>
              <Kbd>Ctrl</Kbd>
              <Kbd>↑</Kbd>
            </KbdGroup>{' '}
            或{' '}
            <KbdGroup>
              <Kbd>Ctrl</Kbd>
              <Kbd>↓</Kbd>
            </KbdGroup>{' '}
            在选项之间导航
          </p>
          <p className="text-sm text-muted-foreground">
            按 <Kbd>Enter</Kbd> 确认,<Kbd>Esc</Kbd> 取消
          </p>
        </div>
      </div>
    </div>
  )
}
