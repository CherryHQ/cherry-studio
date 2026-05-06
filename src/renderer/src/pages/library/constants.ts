import type { AssistantSettings } from '@shared/data/types/assistant'
import { Bot, MessageCircle, Zap } from 'lucide-react'

import type { ResourceType, ResourceTypeUIConfig } from './types'

export type AssistantConfigMcpMode = AssistantSettings['mcpMode']

type ResourceTypeMeta = ResourceTypeUIConfig & { labelKey: string }

export const RESOURCE_TYPE_META: Record<ResourceType, ResourceTypeMeta> = {
  agent: {
    icon: Bot,
    color: 'text-violet-500 bg-violet-500/10',
    labelKey: 'library.type.agent'
  },
  assistant: {
    icon: MessageCircle,
    color: 'text-sky-500 bg-sky-500/10',
    labelKey: 'library.type.assistant'
  },
  skill: {
    icon: Zap,
    color: 'text-amber-500 bg-amber-500/10',
    labelKey: 'library.type.skill'
  }
}

export const RESOURCE_TYPE_ORDER: ResourceType[] = ['agent', 'assistant', 'skill']

export const MCP_MODE_OPTIONS: {
  id: AssistantConfigMcpMode
  labelKey: string
  descKey: string
}[] = [
  {
    id: 'disabled',
    labelKey: 'library.config.tools.mode.disabled.label',
    descKey: 'library.config.tools.mode.disabled.desc'
  },
  {
    id: 'auto',
    labelKey: 'library.config.tools.mode.auto.label',
    descKey: 'library.config.tools.mode.auto.desc'
  },
  {
    id: 'manual',
    labelKey: 'library.config.tools.mode.manual.label',
    descKey: 'library.config.tools.mode.manual.desc'
  }
]

export const DEFAULT_TAG_COLOR = '#6b7280'
export const TAG_COLOR_PALETTE = ['#8b5cf6', '#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#ec4899', '#06b6d4']

export function getRandomTagColor(): string {
  if (TAG_COLOR_PALETTE.length === 0) return DEFAULT_TAG_COLOR
  const idx = Math.floor(Math.random() * TAG_COLOR_PALETTE.length)
  return TAG_COLOR_PALETTE[idx]
}
