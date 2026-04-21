import { Bot, MessageCircle, Zap } from 'lucide-react'

import type { ResourceType, ResourceTypeUIConfig } from './types'

export const RESOURCE_TYPE_CONFIG: Record<ResourceType, ResourceTypeUIConfig> = {
  agent: { label: '智能体', icon: Bot, color: 'text-violet-500 bg-violet-500/10' },
  assistant: { label: '助手', icon: MessageCircle, color: 'text-sky-500 bg-sky-500/10' },
  skill: { label: '技能', icon: Zap, color: 'text-amber-500 bg-amber-500/10' }
}

export const RESOURCE_TYPES_LIST: { id: ResourceType; label: string; icon: typeof Bot }[] = [
  { id: 'agent', label: '智能体', icon: Bot },
  { id: 'assistant', label: '助手', icon: MessageCircle },
  { id: 'skill', label: '技能', icon: Zap }
]

export const SORT_LABELS: Record<string, string> = {
  updatedAt: '最近修改',
  createdAt: '创建时间',
  name: '名称排序'
}

export const TAG_COLORS: Record<string, string> = {
  生产力: '#8b5cf6',
  写作: '#10b981',
  编程: '#3b82f6',
  翻译: '#f59e0b',
  分析: '#ef4444',
  创意: '#ec4899',
  对话: '#06b6d4',
  通用: '#6b7280'
}

export const DEFAULT_TAG_COLOR = '#6b7280'

export const PENDING_BACKEND_TYPES: ReadonlySet<ResourceType> = new Set(['agent', 'skill'])
