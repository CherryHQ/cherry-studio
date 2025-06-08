import {
  Eraser,
  FileSearch,
  Globe,
  Image,
  Languages,
  Lightbulb,
  Maximize,
  MessageSquareDiff,
  PaintbrushVertical,
  Paperclip,
  SquareTerminal,
  Zap
} from 'lucide-react'
import React from 'react'

// 输入框图标类型定义 - 参考侧边栏的严格类型定义
export type InputBoxIconType =
  | 'new_topic'
  | 'attachment'
  | 'thinking'
  | 'web_search'
  | 'knowledge_base'
  | 'mcp_tools'
  | 'generate_image'
  | 'mention_models'
  | 'quick_phrases'
  | 'clear_topic'
  | 'expand_collapse'
  | 'new_context'
  | 'token_count'
  | 'translate'
  | 'send_pause'

// 输入框图标的类型定义
export interface InputBoxIconInfo {
  id: InputBoxIconType
  name: string
  icon: React.ReactNode
  tooltip: string
  position: 'left' | 'right'
  visible: boolean
  order: number
  component?: string
  condition?: string
}

// 图标配置映射 - 减少重复代码
interface IconDefinition {
  icon: any
  size: number
  name: string
  tooltip: string
  color?: string
}

const ICON_CONFIGS: Record<string, IconDefinition> = {
  new_topic: { icon: MessageSquareDiff, size: 19, name: '新话题', tooltip: 'chat.input.new_topic' },
  attachment: { icon: Paperclip, size: 18, name: '附件', tooltip: 'chat.input.upload' },
  web_search: { icon: Globe, size: 18, name: '网络搜索', tooltip: 'chat.input.web_search' },
  knowledge_base: { icon: FileSearch, size: 18, name: '知识库', tooltip: 'chat.input.knowledge_base' },
  mcp_tools: { icon: SquareTerminal, size: 18, name: 'MCP工具', tooltip: 'settings.mcp.title' },
  generate_image: { icon: Image, size: 18, name: '生成图片', tooltip: 'chat.input.generate_image' },
  quick_phrases: { icon: Zap, size: 18, name: '快捷短语', tooltip: 'settings.quickPhrase.title' },
  clear_topic: { icon: PaintbrushVertical, size: 18, name: '清空话题', tooltip: 'chat.input.clear' },
  expand_collapse: { icon: Maximize, size: 18, name: '展开/收起', tooltip: 'chat.input.expand' },
  new_context: { icon: Eraser, size: 18, name: '新上下文', tooltip: 'chat.input.new.context' },
  translate: { icon: Languages, size: 18, name: '翻译', tooltip: 'chat.input.translate' }
}

// 创建图标元素的辅助函数
function createIcon(iconKey: string) {
  const config = ICON_CONFIGS[iconKey]
  if (!config) return null

  const props: any = { size: config.size }
  if (config.color) {
    props.style = { color: config.color, fontSize: config.size }
  }
  return React.createElement(config.icon, props)
}

// 特殊图标创建函数
function createSpecialIcons() {
  return {
    thinking: React.createElement(Lightbulb, {
      size: 18,
      style: { color: 'var(--color-icon)' }
    }),
    mention_models: React.createElement('span', { style: { fontSize: 18 } }, '@'),
    token_count: React.createElement(
      'div',
      {
        style: {
          fontSize: 11,
          padding: '3px 10px',
          border: '0.5px solid var(--color-text-3)',
          borderRadius: 20,
          color: 'var(--color-text-2)'
        }
      },
      '0/0'
    ),
    send_pause: React.createElement('i', {
      className: 'iconfont icon-ic_send',
      style: { fontSize: 22, color: 'var(--color-primary)' }
    })
  }
}

// 定义并返回所有可用的输入框图标信息
export function getInputBoxIcons(): InputBoxIconInfo[] {
  const specialIcons = createSpecialIcons()

  // 左侧图标配置
  const leftIconsConfig = [
    { id: 'new_topic', order: 1, condition: 'always', visible: true },
    { id: 'attachment', order: 2, condition: 'always', visible: true },
    {
      id: 'thinking',
      order: 3,
      condition: 'showThinkingButton',
      name: '思考模式',
      tooltip: 'assistants.settings.reasoning_effort',
      visible: true
    },
    { id: 'web_search', order: 4, condition: 'always', visible: true },
    { id: 'knowledge_base', order: 5, condition: 'showKnowledgeIcon', visible: true },
    { id: 'mcp_tools', order: 6, condition: 'activedMcpServers.length > 0', visible: true },
    { id: 'generate_image', order: 7, condition: 'isGenerateImageModel(model)', visible: true },
    {
      id: 'mention_models',
      order: 8,
      condition: 'always',
      name: '提及模型',
      tooltip: 'agents.edit.model.select.title',
      visible: true
    },
    { id: 'quick_phrases', order: 9, condition: 'always', visible: true },
    { id: 'clear_topic', order: 10, condition: 'always', visible: true },
    { id: 'expand_collapse', order: 11, condition: 'always', visible: true },
    { id: 'new_context', order: 12, condition: 'always', visible: true },
    {
      id: 'token_count',
      order: 13,
      condition: 'showInputEstimatedTokens',
      name: 'Token计数',
      tooltip: 'Token计数',
      visible: true
    }
  ]

  // 右侧图标配置
  const rightIconsConfig = [
    { id: 'translate', order: 1, condition: 'always', visible: true },
    { id: 'send_pause', order: 2, condition: 'always', name: '发送/暂停', tooltip: '发送消息或暂停生成', visible: true }
  ]

  // 生成左侧图标
  const leftIcons = leftIconsConfig.map((config) => ({
    id: config.id as InputBoxIconType,
    name: config.name || ICON_CONFIGS[config.id]?.name || config.id,
    icon: specialIcons[config.id as keyof typeof specialIcons] || createIcon(config.id),
    tooltip: config.tooltip || ICON_CONFIGS[config.id]?.tooltip || config.id,
    position: 'left' as const,
    visible: config.visible,
    order: config.order,
    component: `${config.id}Component`,
    condition: config.condition
  }))

  // 生成右侧图标
  const rightIcons = rightIconsConfig.map((config) => ({
    id: config.id as InputBoxIconType,
    name: config.name || ICON_CONFIGS[config.id]?.name || config.id,
    icon: specialIcons[config.id as keyof typeof specialIcons] || createIcon(config.id),
    tooltip: config.tooltip || ICON_CONFIGS[config.id]?.tooltip || config.id,
    position: 'right' as const,
    visible: config.visible,
    order: config.order,
    component: `${config.id}Component`,
    condition: config.condition
  }))

  return [...leftIcons, ...rightIcons]
}

// 根据条件过滤可见的图标
export function getVisibleInputBoxIcons(
  icons: InputBoxIconInfo[],
  conditions: Record<string, boolean> = {}
): InputBoxIconInfo[] {
  return icons.filter((icon) => {
    if (!icon.visible) return false

    // 检查显示条件
    switch (icon.condition) {
      case 'always':
        return true
      case 'showThinkingButton':
        return conditions.showThinkingButton ?? true
      case 'showKnowledgeIcon':
        return conditions.showKnowledgeIcon ?? true
      case 'activedMcpServers.length > 0':
        return conditions.hasMcpServers ?? false
      case 'isGenerateImageModel(model)':
        return conditions.isGenerateImageModel ?? false
      case 'showInputEstimatedTokens':
        return conditions.showInputEstimatedTokens ?? false
      default:
        return true
    }
  })
}

// 按位置和顺序排序图标
export function sortIconsByPosition(icons: InputBoxIconInfo[]): {
  leftIcons: InputBoxIconInfo[]
  rightIcons: InputBoxIconInfo[]
} {
  const leftIcons = icons.filter((icon) => icon.position === 'left').sort((a, b) => a.order - b.order)

  const rightIcons = icons.filter((icon) => icon.position === 'right').sort((a, b) => a.order - b.order)

  return { leftIcons, rightIcons }
}
