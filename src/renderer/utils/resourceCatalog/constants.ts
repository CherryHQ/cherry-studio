import type { ResourceType, ResourceTypeUIConfig } from '@renderer/types/resourceCatalog'
import type { AssistantSettings } from '@shared/data/types/assistant'
import { Bot, FileText, MessageCircle, ToolCase } from 'lucide-react'

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
    icon: ToolCase,
    color: 'bg-warning-bg text-warning',
    labelKey: 'library.type.skill'
  },
  prompt: {
    icon: FileText,
    color: 'bg-secondary text-foreground',
    labelKey: 'library.type.prompt'
  }
}

export const RESOURCE_TYPE_ORDER: ResourceType[] = ['agent', 'assistant', 'skill', 'prompt']

export const RESOURCE_PROMPT_POLISH_SYSTEM_PROMPT = [
  'Improve the supplied system prompt without changing its intent or authority.',
  'Preserve roles, goals, constraints, tool instructions, workflows, and output requirements.',
  'Do not replace its structure or force it into a predefined template.',
  'Keep the output in the same language as the input.',
  'Preserve Markdown, code, URLs, and every placeholder token verbatim, including tokens shaped like {{name}} and ${name}; keep duplicate occurrences.',
  'Return only the polished system prompt with no explanation, wrapper, or code fence.'
].join('\n')

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
