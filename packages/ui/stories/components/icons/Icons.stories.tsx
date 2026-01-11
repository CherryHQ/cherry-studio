import type { Meta, StoryObj } from '@storybook/react'

import {
  AddCategory,
  AiChat,
  Aicon27,
  AiEssentialsIconSet,
  AiPrompt,
  Brain,
  BrainCircuit,
  BrainCog,
  CodeAi,
  Emoji,
  Group,
  MessageAi1,
  MessageBalloonAi1,
  Vector
} from '../../../src/components/icons/general'

// Icon 列表，包含组件和名称
const icons = [
  { Component: AddCategory, name: 'AddCategory' },
  { Component: AiChat, name: 'AiChat' },
  { Component: Aicon27, name: 'Aicon27' },
  { Component: AiEssentialsIconSet, name: 'AiEssentialsIconSet' },
  { Component: AiPrompt, name: 'AiPrompt' },
  { Component: Brain, name: 'Brain' },
  { Component: BrainCircuit, name: 'BrainCircuit' },
  { Component: BrainCog, name: 'BrainCog' },
  { Component: CodeAi, name: 'CodeAi' },
  { Component: Emoji, name: 'Emoji' },
  { Component: Group, name: 'Group' },
  { Component: MessageAi1, name: 'MessageAi1' },
  { Component: MessageBalloonAi1, name: 'MessageBalloonAi1' },
  { Component: Vector, name: 'Vector' }
]

interface IconsShowcaseProps {
  fontSize?: number
}

const IconsShowcase = ({ fontSize = 32 }: IconsShowcaseProps) => {
  return (
    <div className="flex flex-wrap gap-4 p-2">
      {icons.map(({ Component, name }) => (
        <div key={name} className="flex flex-col items-center justify-center">
          <div className="border-gray-200 border-1 rounded-md p-2 w-min" key={name} style={{ fontSize }}>
            <Component />
          </div>
          <p className="text-sm text-center mt-2">{name}</p>
        </div>
      ))}
    </div>
  )
}

const meta: Meta<typeof IconsShowcase> = {
  title: 'Components/Icons/General',
  component: IconsShowcase,
  parameters: {
    layout: 'fullscreen'
  },
  tags: ['autodocs'],
  argTypes: {
    fontSize: {
      control: { type: 'number', min: 16, max: 64, step: 4 },
      description: 'Icon 大小（通过 fontSize 控制，因为图标使用 1em 单位）',
      defaultValue: 32
    }
  }
}

export default meta
type Story = StoryObj<typeof IconsShowcase>

/**
 * 展示所有 14 个通用图标
 *
 * 这些图标使用 SVGR 的 `icon: true` 选项生成，具有以下特点：
 * - 使用 `width="1em"` 和 `height="1em"`，响应父元素的 `fontSize`
 * - 保留所有原始 SVG 属性（颜色、渐变、clipPath 等）
 * - 支持标准的 SVG props（className, style, onClick 等）
 *
 * ## 使用示例
 *
 * ```tsx
 * import { Brain } from '@cherrystudio/ui/icons'
 *
 * // 通过 fontSize 控制大小
 * <div style={{ fontSize: 24 }}>
 *   <Brain />
 * </div>
 *
 * // 通过 className 控制（Tailwind）
 * <Brain className="text-2xl" />
 *
 * // 使用标准 SVG props
 * <Brain className="hover:opacity-80" onClick={handleClick} />
 * ```
 */
export const AllIcons: Story = {
  args: {
    fontSize: 32
  }
}
