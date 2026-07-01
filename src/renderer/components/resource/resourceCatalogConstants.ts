import type { ResourceType, ResourceTypeUIConfig } from '@renderer/types/resourceCatalog'
import type { AssistantSettings } from '@shared/data/types/assistant'
import { Bot, FileText, MessageCircle, Zap } from 'lucide-react'

export { DEFAULT_TAG_COLOR, getRandomTagColor, TAG_COLOR_PALETTE } from '@renderer/utils/resourceTags'

export type AssistantConfigMcpMode = AssistantSettings['mcpMode']

type ResourceTypeMeta = ResourceTypeUIConfig & { labelKey: string }

export const RESOURCE_TYPE_META: Record<ResourceType, ResourceTypeMeta> = {
  agent: {
    icon: Bot,
    color: 'bg-secondary text-foreground',
    labelKey: 'library.type.agent'
  },
  assistant: {
    icon: MessageCircle,
    color: 'bg-secondary text-foreground',
    labelKey: 'library.type.assistant'
  },
  skill: {
    icon: Zap,
    color: 'bg-warning-bg text-warning-text',
    labelKey: 'library.type.skill'
  },
  prompt: {
    icon: FileText,
    color: 'bg-secondary text-foreground',
    labelKey: 'library.type.prompt'
  }
}

export const RESOURCE_TYPE_ORDER: ResourceType[] = ['agent', 'assistant', 'skill', 'prompt']

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
